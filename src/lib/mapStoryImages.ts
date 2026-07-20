const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2560;
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

function isHeic(file: File) {
  return /hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The image could not be converted."))),
      "image/jpeg",
      quality,
    );
  });
}

async function browserReadableBlob(file: File) {
  if (!isHeic(file)) {
    return file;
  }

  const { default: heic2any } = await import("heic2any");
  const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
  return Array.isArray(converted) ? converted[0] : converted;
}

export async function prepareMapStoryImage(file: File) {
  if (!file.type.startsWith("image/") && !isHeic(file)) {
    throw new Error("Choose an image file, including JPEG, PNG, WebP, HEIC, or HEIF.");
  }

  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("Choose an original image smaller than 40 MB.");
  }

  const readable = await browserReadableBlob(file);
  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(readable, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This image could not be read. Try exporting it as JPEG or PNG.");
  }

  let scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  let output: Blob | null = null;

  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Image conversion is not supported in this browser.");
      }

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      output = await canvasToBlob(canvas, Math.max(0.58, 0.88 - attempt * 0.05));

      if (output.size <= MAX_UPLOAD_BYTES) {
        return output;
      }

      scale *= Math.min(0.88, Math.sqrt(MAX_UPLOAD_BYTES / output.size) * 0.94);
    }
  } finally {
    bitmap.close();
  }

  throw new Error("The image could not be reduced below 2 MB. Try a smaller image.");
}

export const MAP_STORY_IMAGE_BUCKET = "map-story-images";
export const MAP_STORY_IMAGE_MAX_MB = 2;
