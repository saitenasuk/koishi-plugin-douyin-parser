import { Context, Schema, h } from "koishi";
export const name = "douyin-parser";

export interface Config {
  url: string;
  video: any;
}

export const Config: Schema<Config> = Schema.object({
  url: Schema.string()
    .description("Api地址示例：http://127.0.0.1:80")
    .required(),
  // isSend: Schema.boolean().description("是否发送视频").default(true),
  video: Schema.intersect([
    Schema.object({
      isSend: Schema.boolean().default(false).description('是否发送视频'),
    }),
    Schema.union([
      Schema.object({
        isSend: Schema.const(true).required(),
        isCache: Schema.boolean().default(false).description('是否缓存到内存后再发送,小内存机器建议关闭或调整视频大小限制'),
        maxDuration: Schema.number().description('允许发送的最大视频长度(秒),0为不限制').default(0).min(0),
        maxSize: Schema.number().description('允许发送的最大视频大小(MB),0为不限制').default(0).min(0),
      }),
      Schema.object({}),
    ])
  ])
});

//计算视频时长
function formatMilliseconds(milliseconds) {
  let seconds = Math.floor(milliseconds / 1000);
  let minutes = Math.floor(seconds / 60);
  let hours = Math.floor(minutes / 60);
  seconds %= 60;
  minutes %= 60;
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `${hh}时${mm}分${ss}秒`;
}
type videoInfo = {
  desc: string,  //视频描述
  author: string, //作者
  digg_count: number, //点赞数
  share_count: number, //分享数
  comment_count: number, //评论数
  collect_count: number, //收藏数
  videoCover: string, //视频封面
  duration: number, //视频时长
  videoData: any, //视频数据
}

const videoInfo: videoInfo = {
  desc: "",
  author: "",
  digg_count: 0,
  share_count: 0,
  comment_count: 0,
  collect_count: 0,
  videoCover: "",
  videoData: {},
  duration: 0,
}

export function apply(ctx: Context, config: Config) {
  // ctx.logger.info("读取到临时缓存目录：",os.tmpdir());
  ctx.on("message", async (session) => {
    //不解析bot自己的消息
    if (session.selfId === session.userId) return;
    if (
      session.content.includes("douyin.com") ||
      session.content.includes("tiktok.com")
    ) {
      try {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const url = session.content.match(urlRegex)[0];
        const response = await fetch(
          `${config.url}/api/hybrid/video_data?url=${url}&minimal=false`
        );
        if (!response.ok) {
          return session.send(
            h("quote", { id: session.messageId }) + "解析失败! 该链接或许不支持"
          );
        }
        const res = await response.json();
        if(session.content.includes("douyin.com")){
          const { desc, author, statistics, video, duration } = res.data;
          const { digg_count, share_count, comment_count, collect_count } = statistics;
          const { big_thumbs, bit_rate, cover } = video;

          // 直接更新 videoInfo
          Object.assign(videoInfo, {
            desc,
            author: author.nickname,
            digg_count,
            share_count,
            comment_count,
            collect_count,
            videoCover: big_thumbs[0]?.img_url || cover.url_list[0],
            duration,
          });
          const videoQuality: string[] = [
            "adapt_lowest_1080_1", // 最高优先级
            "adapt_lowest_720_1", // 中等优先级                       
            "normal_1080_0", // 次高优先级
            "normal_720_0", // 中等优先级
            "normal_540_0", // 低优先级
            "adapt_low_540_0", // 最低优先级
          ];
  
          // let video_info = findBestQualityVideo(bit_rate, videoQuality);
          for (const priority of videoQuality) {
            videoInfo.videoData = bit_rate.find(
              (item: any) => item.format === "mp4" && item.gear_name === priority
            );
            if (videoInfo.videoData) {
              videoInfo.videoData = videoInfo.videoData.play_addr;
              break; // 找到符合优先级的项，退出循环
            }else{
              videoInfo.videoData = bit_rate[0]?.play_addr || null; //未找到符合优先级的项，使用最低优先级
            }
          }
        }else{ 
          //Tiktok
          const { desc, author, statistics, video } = res.data;
          const { digg_count, share_count, comment_count, collect_count } = statistics;
          const { big_thumbs, bit_rate,play_addr,play_addr_h264, cover, duration } = video;

          // 直接更新 videoInfo
          Object.assign(videoInfo, {
            desc,
            author: author.nickname,
            digg_count,
            share_count,
            comment_count,
            collect_count,
            videoCover: big_thumbs?.[0]?.img_url || cover?.url_list?.[0],
            duration,
          });
          videoInfo.videoData = play_addr || play_addr_h264 || bit_rate[0]?.play_addr || null; //未找到符合优先级的项，使用最低优先级

        }
      
        console.log("video_info :>> ", videoInfo);
        const videoTitle =
          "标题：" +
          videoInfo.desc +
          "\n作者：" +
          videoInfo.author +
          "\n点赞数：" +
          videoInfo.digg_count +
          "\t  分享数：" +
          videoInfo.share_count +
          "\n评论数：" +
          videoInfo.comment_count +
          "\t  收藏数：" +
          videoInfo.collect_count +
          (config.video.isSend ? "\n时长：" +
              formatMilliseconds(videoInfo.duration) +
              "\t  大小：" +
              (videoInfo.videoData.data_size / 1024 / 1024).toFixed(2) +
              "MB" : "")
        console.log(videoTitle);
        // return;
        await session.sendQueued(
          //发送视频信息 
          h(
            "p",
            h("quote", { id: session.messageId }),
            h("img", {
              src: videoInfo.videoCover
            }),
            videoTitle
          )
        );
        //检测视频大小与时长
        if (config.video.maxSize && config.video.maxSize !== 0 && videoInfo.videoData.data_size / 1024 / 1024 > config.video.maxSize) {
          ctx.logger.warn(`视频大小超过限制 (${config.video.maxSize}MB)，取消发送`)
          return;
        }
        if (config.video.maxDuration && config.video.maxDuration !== 0 && videoInfo.duration / 1000 > config.video.maxDuration) {
          ctx.logger.warn(`视频时长超过限制 (${config.video.maxDuration}秒)，取消发送`)
          return;
        }
        //发送视频
        if (config.video.isSend && config.video.isCache) {
          //缓存到内存后再发送
          try {
            const videoBuffer = await ctx.http.get<ArrayBuffer>(config.url + '/api/download?url=' + url + '&prefix=true&with_watermark=false', {
              responseType: 'arraybuffer',
            });
            

            
            // 直接发送视频buffer，避免文件路径问题
            await session.sendQueued(h.video(Buffer.from(videoBuffer), 'video/mp4'))
          } catch (error) {
            ctx.logger.error('视频缓存发送失败，尝试直接发送链接:', error)
            // 如果缓存发送失败，回退到直接发送链接
            await session.sendQueued(
              h("video", { src: videoInfo.videoData.url_list[0] })
            );
          }
        }else if(config.video.isSend) {
          await session.sendQueued(
            h("video", { src: videoInfo.videoData.url_list[0] })
          );
        }
      } catch (error) {
        console.log(error);
        return session.send(
          h("quote", { id: session.messageId }) + "发生错误：" + error.message
        );
      } finally {
        await session.cancelQueued();
      }
    }
  });
}
