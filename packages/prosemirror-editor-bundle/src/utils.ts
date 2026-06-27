import type { ResourceItem } from "./types";

/**
 * 判断是否为视频URL
 */
export function isVideoUrl(url: string): boolean {
  if (!url) return false;
  return /\.(mp4|webm|mov|avi|mkv)$/i.test(url);
}

/**
 * 根据资源 URL 拼接缩略图 URL
 * 视频URL格式: /static/{asset_id}_{display_name}.mp4
 * 缩略图URL格式: /static/thumbnails/thumb_{asset_id}_{display_name}.jpg
 */
export function getThumbnailUrlFromAssetUrl(url: string, type?: "image" | "video" | "audio"): string {
  if (!url) return "";

  // 如果是外部链接，无法拼接缩略图
  if (url.startsWith("http://") || url.startsWith("https://")) {
    // 对于图片，直接返回原URL
    if (type === "image") return url;
    return "";
  }

  // 图片直接返回原 URL
  if (type === "image" || /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(url)) {
    return url;
  }

  // 视频或音频：拼接缩略图 URL
  // 从 URL 中提取文件名部分
  // URL 格式: /static/abc123_video1.mp4 或 /static/thumbnails/thumb_abc123_video1.jpg
  const match = url.match(/\/static\/([^/]+)$/);
  if (!match) return "";

  const filename = match[1] || "";
  // 提取 {asset_id}_{display_name} 部分（去掉扩展名）
  const nameWithoutExt = filename.replace(/\.[^.]+$/, "");

  // 如果已经是缩略图路径，直接返回
  if (url.includes("/thumbnails/")) {
    return url;
  }

  // 拼接缩略图 URL
  return `/static/thumbnails/thumb_${nameWithoutExt}.jpg`;
}

/**
 * 请求后台生成缩略图
 */
export async function requestThumbnailGeneration(url: string): Promise<string | null> {
  try {
    const response = await fetch("/thumbnails/generate", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `url=${encodeURIComponent(url)}`,
    });
    const data = await response.json();
    if (data.success && data.data?.thumbnail_url) {
      return data.data.thumbnail_url;
    }
    return null;
  } catch (e) {
    console.error("生成缩略图失败:", e);
    return null;
  }
}

/**
 * 加载图片，优先使用缩略图，失败时自动回退
 * @param img - 图片元素
 * @param resource - 资源项
 * @param regenerateOnFail - 缩略图不存在时是否请求重新生成
 * @returns 返回一个函数用于取消加载
 */
export function loadImageWithThumbnail(
  img: HTMLImageElement,
  resource: ResourceItem,
  regenerateOnFail: boolean = true
): () => void {
  let isCancelled = false;
  const triedUrls = new Set<string>();

  // 计算预览图 URL
  const thumbnailUrl = resource.thumbnail_url || getThumbnailUrlFromAssetUrl(resource.url, resource.type);
  
  // 要尝试的 URL 列表（按优先级）
  const urlsToTry: string[] = [];
  
  // 1. 优先使用缩略图（如果有且不是视频）
  if (thumbnailUrl && thumbnailUrl !== resource.url) {
    urlsToTry.push(thumbnailUrl);
  }
  
  // 2. 原始 URL
  if (resource.url) {
    urlsToTry.push(resource.url);
  }

  // 如果没有可用的 URL，隐藏图片
  if (urlsToTry.length === 0) {
    img.style.display = "none";
    return () => {};
  }

  // 尝试加载下一个 URL
  async function tryNextUrl() {
    if (isCancelled) return;

    // 找到下一个未尝试过的 URL
    const nextUrl = urlsToTry.find(url => !triedUrls.has(url));
    
    if (!nextUrl) {
      // 所有 URL 都尝试过，隐藏图片
      img.style.display = "none";
      return;
    }

    triedUrls.add(nextUrl);
    img.src = nextUrl;
  }

  // 处理图片加载错误
  async function handleError() {
    if (isCancelled) return;

    const failedUrl = img.src;

    // 如果是缩略图加载失败，尝试重新生成
    if (regenerateOnFail && 
        failedUrl.includes("/thumbnails/") && 
        failedUrl !== resource.url) {
      const newThumbnailUrl = await requestThumbnailGeneration(resource.url);
      
      if (isCancelled) return;

      if (newThumbnailUrl && !triedUrls.has(newThumbnailUrl)) {
        // 重新生成的缩略图 URL 加入列表并尝试
        urlsToTry.push(newThumbnailUrl);
        tryNextUrl();
        return;
      }
    }

    // 尝试下一个 URL
    tryNextUrl();
  }

  // 绑定错误处理
  img.onerror = handleError;
  img.onload = () => {
    // 加载成功，显示图片
    img.style.display = "";
  };

  // 开始加载第一个 URL
  tryNextUrl();

  // 返回取消函数
  return () => {
    isCancelled = true;
    img.onerror = null;
    img.onload = null;
  };
}
