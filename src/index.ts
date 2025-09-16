import { log } from "console";
import { Context, Schema, Session, h } from "koishi";
export const name = "douyin-parser";

export interface Config {
  url: string;
  video: {
    isSend: boolean;
    isThumbs: boolean;
    isCache?: boolean;
    maxDuration?: number;
    maxSize?: number;
  };
}

export const Config = Schema.object({
  url: Schema.string()
    .description("Api地址示例：http://127.0.0.1:80")
    .required(),
  // isSend: Schema.boolean().description("是否发送视频").default(true),
  video: Schema.intersect([
    Schema.object({
      isSend: Schema.boolean().default(false).description('是否发送视频'),
      isThumbs: Schema.boolean().default(false).description('封面是否使用缩略图'),
    }),
    Schema.union([
      Schema.object({
        isSend: Schema.const(true).required(),
        isCache: Schema.boolean().default(false).description('是否缓存到内存后再发送,小内存机器建议关闭或调整视频大小限制,linux系统部署的koishi建议开启').hidden(true),
        maxDuration: Schema.number().description('允许发送的最大视频长度(秒),0为不限制').default(0).min(0),
        maxSize: Schema.number().description('允许发送的最大视频大小(MB),0为不限制').default(0).min(0).hidden(true),
      }),
      Schema.object({}),
    ])
  ])
});

// API返回的视频数据结构
interface ResultVideoData {
  media_type?: number; //媒体类型，2为图文，4为视频
  desc: string;  //视频描述
  duration: number; //视频时长
  images: { download_url_list: string[] }[]; //图文
  author: { nickname: string };  //作者
  statistics: {
    digg_count: number; //点赞数
    share_count: number; //分享数
    comment_count: number; //评论数
    collect_count: number; //收藏数
  }; 
  video: { 
    cover: { url_list: string[] }, //视频封面 
    big_thumbs?: { img_url: string }[]; //视频封面 缩略图
    duration: number; //视频时长
    // bit_rate: { format: string; gear_name: string; play_addr: string }[]; //视频数据
  };
}


// 提取链接
function extractUrl(content: string): string | null {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const match = content.match(urlRegex);
  return match ? match[0] : null;
}

// 计算视频时长
function formatMilliseconds(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${hh}时${mm}分${ss}秒`;
}

// 构建视频信息文本
function buildVideoInfoText(info: ResultVideoData, isSend: Config | boolean): string {
  const videoTitle =
          "标题：" +
          info.desc +
          "\n作者：" +
          info.author.nickname +
          "\n点赞数：" +
          info.statistics.digg_count +
          "\t  分享数：" +
          info.statistics.share_count +
          "\n评论数：" +
          info.statistics.comment_count +
          "\t  收藏数：" +
          info.statistics.collect_count +
          // (isSend ? "\n时长：" +
          //     formatMilliseconds(info.duration) +
          //     "\t  大小：" +
          //     (info.videoData.data_size / 1024 / 1024).toFixed(2) +
          //     "MB" : "")
          (isSend ? "\n时长：" +
          formatMilliseconds(info.duration || info.video.duration) : "");

  return videoTitle;
}

// 从API获取视频数据
async function getVideoData(url: string, config: Config, session, ctx: Context): Promise<ResultVideoData | null> {
  try {
    const response = await fetch(
      `${config.url}/api/hybrid/video_data?url=${url}&minimal=false`
    );
    
    if (!response.ok) {
      ctx.logger.warn(`API请求失败 - 状态码: ${response.status}, URL: ${url}`);
      await session.sendQueued(
        h("p",
          h("quote", { id: session.messageId }),
          "解析失败! 该链接或许不支持"
        )
      );
      return null;
    }
    
    const { data } = await response.json() as { data: ResultVideoData };
    ctx.logger.info(`链接解析成功 - URL: ${url}, 媒体类型: ${data.media_type===2? '图文' :'视频'}`);
    return data;
  } catch (error) {
    ctx.logger.error(`获取视频数据时发生错误 - URL: ${url}`, error);
    await session.sendQueued(
      h("p",
        h("quote", { id: session.messageId }),
        "网络请求失败，请检查API服务是否正常"
      )
    );
    return null;
  }
}

// 检查视频限制
function checkVideoLimits(info: ResultVideoData, config: Config, ctx: Context ): string | boolean {
  // const videoSizeMB = info.videoData.data_size / 1024 / 1024;
  // if (config.video.maxSize > 0 && videoSizeMB > config.video.maxSize) {
  //   ctx.logger.warn(`视频大小 (${videoSizeMB.toFixed(2)}MB) 超过限制 (${config.video.maxSize}MB)，取消发送`);
  //   return "视频大小超过限制，取消发送"
  // }
  const videoDurationSeconds = info.duration / 1000;
  if (config.video.maxDuration > 0 && videoDurationSeconds > config.video.maxDuration) {
    ctx.logger.warn(`视频时长 (${videoDurationSeconds}秒) 超过限制 (${config.video.maxDuration}秒)，取消发送`);
    return "视频时长超过限制，取消发送"
  }
  return true
}

//处理视频
async function handleVideo(videoData: ResultVideoData, config: Config, session: Session, ctx: Context, url: string) {
  try {
    // 构建视频信息文本
    const videoInfo = buildVideoInfoText(videoData, config.video.isSend);
    // 检测视频时长是否超过限制
    const check = checkVideoLimits(videoData, config, ctx)
      // 发送视频基本信息
  await session.sendQueued(
    h("p",
      h("quote", { id: session.messageId }),
      h("img", { src: videoData.video.cover.url_list[0] }),
      buildVideoInfoText(videoData, config.video.isSend)
    )
  );
    // 发送视频
    if (config.video.isSend && check) {
      await session.sendQueued(h('video', { src: `${config.url}/api/download?url=${url}&prefix=true&with_watermark=false` }));
      ctx.logger.info(`视频消息发送成功 - 用户: ${session.userId}, URL: ${url}`);
    } else {
      await session.sendQueued(
        h("p",
          h("quote", { id: session.messageId }),
          videoInfo
        )
      );
      ctx.logger.info(`视频信息发送成功（不包含视频文件） - 用户: ${session.userId},URL: ${url}`);
    }
  } catch (error) {
    ctx.logger.error(`处理视频消息时发生错误 - 用户: ${session.userId}, URL: ${url}`, error);
    try {
      await session.sendQueued(
        h("p",
          h("quote", { id: session.messageId }),
          "视频处理失败，请稍后重试"
        )
      );
    } catch (sendError) {
      ctx.logger.error(`发送视频错误消息失败 - 用户: ${session.userId}`, sendError);
    }
  }
}


//处理图文
async function handlePhotoText(videoData: ResultVideoData,config,session,ctx,url: string){
  try {
    // 构建文本
    const videoInfo = buildVideoInfoText(videoData,false);
    // 发送图文 如果图片大于1则发送合并消息
    if(videoData.images.length > 1){
      //先创建包含视频信息的第一条消息
      const messagesToForward = [
        h('message',videoInfo)
      ];
      // 然后遍历添加图片消息
      videoData.images.forEach(img => {
        messagesToForward.push(h('message', h('img', { src: img.download_url_list?.[0] })));
      });
      
      await session.sendQueued(
        h('message', { forward: true }, ...messagesToForward)
      );
    }else{
      await session.sendQueued(
            h("p",  
              h("quote", { id: session.messageId }),
              h("img", { src: videoData.images?.[0]?.download_url_list?.[0] }),
              videoInfo
            )
          );
        }
  } catch (error) {
    ctx.logger.error('处理图文消息时发生错误:', error);
    try {
      await session.sendQueued(
        h("p",
          h("quote", { id: session.messageId }),
          "图文处理失败，请稍后重试"
        )
      );
    } catch (sendError) {
      ctx.logger.error('发送错误消息失败:', sendError);
    }
  }
}

//程序入口
export function apply(ctx: Context, config: Config) {
  ctx.on("message", async (session: Session) => {
    // 不解析bot自己的消息
    if (session.selfId === session.userId) return;
    
    // 检查是否包含抖音/ TikTok链接
    const hasDouyin = session.content.includes("douyin.com");
    const hasTiktok = session.content.includes("tiktok.com");
    if (!hasDouyin && !hasTiktok) return;

    try {
      // 提取链接
      const url = extractUrl(session.content);
      if (!url) {
        ctx.logger.warn(`未能提取到有效链接 - 用户: ${session.userId}, 内容: ${session.content}`);
        await session.sendQueued(
          h("p",
            h("quote", { id: session.messageId }),
            "未找到有效的链接"
          )
        );
        return;
      }

      ctx.logger.info(`开始处理链接 - 用户: ${session.userId}, 群组: ${session.guildId || 'DM'}, URL: ${url}`);
      
      // 调用解析API
      const videoData = await getVideoData(url, config, session, ctx);
      if (!videoData) {
        // getVideoData已经处理了错误消息发送
        return;
      }
      
      // 判断是图文还是视频，只有抖音有图文
      if(hasDouyin && videoData.media_type === 2){
        await handlePhotoText(videoData,config,session,ctx,url)
      }else {
        handleVideo(videoData,config,session,ctx,url)
      }
      
      ctx.logger.info(`链接处理完成 - 用户: ${session.userId},群组: ${session.guildId || 'DM'}, URL: ${url}`);
    } catch (error) {
      ctx.logger.error(`处理消息时发生未预期的错误 - 用户: ${session.userId}, 群组: ${session.guildId || 'DM'}`, error);
      try {
        await session.sendQueued(
          h("p",
            h("quote", { id: session.messageId }),
            "处理过程中发生错误，请稍后重试"
          )
        );
      } catch (sendError) {
        ctx.logger.error(`发送错误消息失败`, sendError);
      }
    } finally {
      // 确保清理消息队列
      try {
        await session.cancelQueued();
      } catch (cancelError) {
        ctx.logger.error(`清理消息队列失败`, cancelError);
      }
    }
  });
}
