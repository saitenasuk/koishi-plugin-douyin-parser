import { Context, Schema, h } from "koishi";

export const name = "douyin-parser";

export interface Config {
  url: string;
  isSend: boolean;
}

export const Config: Schema<Config> = Schema.object({
  // analyze: Schema.intersect([
  //   Schema.object({
  //     analyze: Schema.boolean()
  //       .description("是否开启解析抖音，tiktok链接")
  //       .default(false),
  //   }),
  //   Schema.union([
  //     Schema.object({
  //       analyze: Schema.const(true).required(),
  //       link: Schema.string()
  //         .description("Api地址示例：http://127.0.0.1:80")
  //         .required(),
  //     }),
  //     Schema.object({}),
  //   ]),
  // ]),
  url: Schema.string()
    .description("Api地址示例：http://127.0.0.1:80")
    .required(),
  isSend: Schema.boolean().description("是否发送视频").default(true),
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
//查找最佳质量的视频
function findBestQualityVideo(bit_rate, videoQuality) {
  return (
    bit_rate.find(
      (item) => item.format === "mp4" && videoQuality.includes(item.gear_name)
    ) ?? null
  );
}

export function apply(ctx: Context, config: Config) {
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
        // console.log("url :>> ", url);
        console.error("url :>> ", url);
        const response = await fetch(
          `${config.url}/api/hybrid/video_data?url=${url}&minimal=false`
        );
        //解析到视频大小
        if (!response.ok) {
          return session.send(
            h("quote", { id: session.messageId }) + "解析失败! 该链接或许不支持"
          );
        }
        const res = await response.json();
        const { desc, author, statistics, video, duration } = res.data;
        const { nickname } = author;
        const { digg_count, share_count, comment_count, collect_count } =
          statistics;
        const { big_thumbs, bit_rate, cover } = video;
        const videoQuality: string[] = [
          "adapt_lowest_1080_1", // 最高优先级
          "adapt_lowest_720_1", // 中等优先级
          "normal_1080_0", // 次高优先级
          "normal_720_0", // 中等优先级
          "normal_540_0", // 低优先级
          "adapt_low_540_0", // 最低优先级
        ];
        let video_info = null;
        // let video_info = findBestQualityVideo(bit_rate, videoQuality);
        for (const priority of videoQuality) {
          video_info = bit_rate.find(
            (item: any) => item.format === "mp4" && item.gear_name === priority
          );

          if (video_info) {
            break; // 找到符合优先级的项，退出循环
          }
        }
        console.log("video_info :>> ", video_info);
        const text5 =
          "标题：" +
          desc +
          "\n作者：" +
          nickname +
          "\n点赞数：" +
          digg_count +
          "\t  分享数：" +
          share_count +
          "\n评论数：" +
          comment_count +
          "\t  收藏数：" +
          collect_count;
        console.log(text5);
        await session.sendQueued(
          h(
            "p",
            h("quote", { id: session.messageId }),
            h("img", {
              src: big_thumbs[0]?.img_url
                ? big_thumbs[0]?.img_url
                : cover.url_list[0],
            }),
            text5
          )
        );
        if (config.isSend) {
          await session.sendQueued(
            "视频发送中... 时长：" +
              formatMilliseconds(duration) +
              "  大小：" +
              (video_info.play_addr.data_size / 1024 / 1024).toFixed(2) +
              "MB"
          );
          await session.sendQueued(
            // <>
            //   <video src={video_info[0].play_addr.url_list[0]} />
            // </>
            h("video", { src: video_info.play_addr.url_list[0] })
          );
        }
      } catch (error) {
        console.log(error);
        return session.send(
          // <>
          //   <quote id={session.messageId} />
          //   发生错误：{error.message}
          // </>
          h("quote", { id: session.messageId }) + "发生错误：" + error.message
        );
      } finally {
        await session.cancelQueued();
      }
    }
  });
}
