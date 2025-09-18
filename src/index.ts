import { Context, Schema, Session, h } from "koishi";
export const name = "douyin-parser";

export interface Config {
  url: string;
  isThumbs: boolean;
  video: {
    isSend: boolean;
    isCache?: boolean;
    maxDuration?: number;
    maxSize?: number;
  };
}

export const Config = Schema.object({
  url: Schema.string().description("Api地址示例：http://127.0.0.1:80").required(),
  isThumbs: Schema.boolean().default(false).description('封面是否使用缩略图'),
  // isSend: Schema.boolean().description("是否发送视频").default(true),
  video: Schema.intersect([
    Schema.object({
      isSend: Schema.boolean().default(false).description('是否发送视频'),
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
  images: {  //图文类型
    download_url_list: string[],
    video?:{  //图文类型的视频
      download_addr:{
        url_list: string[]
      }
    }
  }[]; 
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
async function getVideoData(url: string, config: Config, ctx: Context): Promise<ResultVideoData> {
  const response = await fetch(
    `${config.url}/api/hybrid/video_data?url=${url}&minimal=false`
  );
  
  if (!response.ok) {
    throw new Error(`API请求失败 - 状态码: ${response.status}, URL: ${url}`);
  }
  
  const { data } = await response.json() as { data: ResultVideoData };
  ctx.logger.info(`链接解析成功 - URL: ${url}, 媒体类型: ${data.media_type===2? '图文' :'视频'}`);
  return data;
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
    return false
  }
  return true
}

//下载视频
async function downloadVideo(url: string, maxSizeMB: number = 1): Promise<Buffer> {
  // 首先发送HEAD请求检查文件大小
  const headResponse = await fetch(url, {
    // method: 'HEAD',
    headers: {
      'Referer': url
    }
  });
  
  // if (!headResponse.ok) {
  //   throw new Error(`无法获取视频信息 - 状态码: ${headResponse.status}, URL: ${url}`);
  // }
  
  // // 检查文件大小
  // const contentLength = headResponse.headers.get('content-length');
  // if (contentLength) {
  //   const fileSizeBytes = parseInt(contentLength);
  //   const fileSizeMB = fileSizeBytes / (1024 * 1024);
    
  //   if (fileSizeMB > maxSizeMB) {
  //     throw new Error(`视频文件过大: ${fileSizeMB.toFixed(2)}MB，超过限制 ${maxSizeMB}MB`);
  //   }
  // }
  
  // // 文件大小检查通过，开始下载
  // const response = await fetch(url, {
  //   headers: {
  //     'Referer': url
  //   }
  // });
  
  if (!headResponse.ok) {
    throw new Error(`视频下载失败 - 状态码: ${headResponse.status}, URL: ${url}`);
  }
  
  return Buffer.from(await headResponse.arrayBuffer());
}

//处理视频
async function handleVideo(videoData: ResultVideoData, config: Config, session: Session, ctx: Context, url: string) {
  // 构建视频信息文本
  const videoInfo = buildVideoInfoText(videoData, config.video.isSend);
  // 检测视频时长是否超过限制
  const check = checkVideoLimits(videoData, config, ctx)
  // 发送视频基本信息
  const msId = await session.sendQueued(
    h("p",
      h("quote", { id: session.messageId }),
      h("img", { src: config.isThumbs ? videoData.video.big_thumbs?.[0]?.img_url : videoData.video.cover.url_list[0] }),
      videoInfo
    )
  );
  // 发送视频
  if (config.video.isSend && check) {
    const result = await session.sendQueued(h('video', { src: `${config.url}/api/download?url=${url}&prefix=true&with_watermark=false` }));
    if (!result || result.length === 0) {
      await session.sendQueued(h("p",h("quote", { id: msId }),"视频发送失败"));
      throw new Error(`视频发送失败 - 用户: ${session.username}, 群组: ${maskNumbers(session.guildId)}, URL: ${url}`);
    }
  }
}
//处理图文
async function handlePhotoText(videoData: ResultVideoData,config,session,ctx,url: string){
  // 构建文本
  const videoInfo = buildVideoInfoText(videoData,false);
  let msId = [];
  // 发送图文 如果图文大于1则发送合并消息
  if(videoData.images.length > 1){
    //先创建包含简介信息的第一条消息
    const messagesToForward = [
      h('message',videoInfo)
    ];
    
    // 收集所有需要下载的视频URL
    const videoUrls: string[] = [];
    videoData.images.forEach(img => {
      if(img.video?.download_addr?.url_list?.[0]){
        videoUrls.push(img.video.download_addr.url_list[0]);
      }
    });
    
    // 异步下载所有视频
    const videoBuffers: Buffer[] = [];
    for(const videoUrl of videoUrls) {
      try {
        const videoBuffer = await downloadVideo(videoUrl);
        videoBuffers.push(videoBuffer);
      } catch (error) {
        ctx.logger.warn(`第${videoUrls.indexOf(videoUrl)+1}个视频下载失败: ${videoUrl}, 错误: ${error.message}`);
      }
    }
    
    // 构建消息，按原始顺序添加图片和视频
    let videoIndex = 0;
    for(let i = 0; i < videoData.images.length; i++) {
      const img = videoData.images[i];
      
      // 有视频流添加视频
      if(img.video?.download_addr?.url_list?.[0] && videoIndex < videoBuffers.length){
        messagesToForward.push(h('message', h.video(videoBuffers[videoIndex], 'video/mp4')));
        videoIndex++;
      }else{
      // 添加图片
      messagesToForward.push(h('message', h('img', { src: img.download_url_list?.[0] })));
      }
      
    }
    
    msId = await session.sendQueued(
      h('message', { forward: true }, ...messagesToForward)
    );
  }else if(videoData.images[0].video?.download_addr?.url_list?.[0]){
    //发送图文类型的视频
    msId = await session.sendQueued(
      h("p",  
        h("quote", { id: session.messageId }),
        h("img", { src: videoData.images?.[0]?.download_url_list?.[0] }),
        videoInfo
      )
    );
          //下载视频
          const videoBuffer = await downloadVideo(videoData.images[0].video?.download_addr?.url_list?.[0]);
          await session.sendQueued(h.video(videoBuffer, 'video/mp4'))
  }else{
    msId = await session.sendQueued(
      h("p",  
        h("quote", { id: session.messageId }),
        h("img", { src: videoData.images?.[0]?.download_url_list?.[0] }),
        videoInfo
      )
    );
  }
  if(!msId || msId.length === 0){
    await session.sendQueued(h("p",h("quote", { id: session.messageId }),"图文发送失败"));
    throw new Error(`图文发送失败 - 用户: ${session.username}, 群组: ${maskNumbers(session.guildId)}, URL: ${url}`);
  }
}

// 混淆数字信息用于日志记录
function maskNumbers(str: string, showLength: number = 3): string {
  if (!str || str.length <= showLength * 2) return str;
  return str.substring(0, showLength) + '****' + str.substring(str.length - showLength);
}

//程序入口
export function apply(ctx: Context, config: Config) {
    // 注册一个命令用于发送本地文件
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
        ctx.logger.warn(`未能提取到有效链接 - 用户: ${session.username}, 内容: ${session.content}`);
        return;
      }

      ctx.logger.info(`开始处理链接 - 用户: ${session.username}, 群组: ${maskNumbers(session.guildId)}, URL: ${url}`);
      
      // 调用解析API
      const videoData = await getVideoData(url, config, ctx);
      // 判断是图文还是视频，只有抖音有图文
      if(hasDouyin && (videoData.media_type === 2 || videoData.media_type === 42)){
        await handlePhotoText(videoData,config,session,ctx,url)
      }else {
        await handleVideo(videoData,config,session,ctx,url)
      }
      
      ctx.logger.info(`链接处理完成 - 用户: ${session.username},群组: ${maskNumbers(session.guildId)}, URL: ${url}`);
    } catch (error) {
      ctx.logger.error(`发生错误 -`, error);
    }finally{
      await session.cancelQueued()
    }
  });
}
