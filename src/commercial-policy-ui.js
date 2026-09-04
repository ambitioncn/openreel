const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");

export function commercialDeclarations(input = {}) {
  if (input.rights !== true || input.noBrands !== true || input.noPublicFigures !== true) throw new TypeError("请确认参考图权利、无品牌且不含公众人物");
  if (!["fictional_adult", "object_only"].includes(input.performer)) throw new TypeError("请选择虚构成人或纯物体声明");
  return { referenceRights: "owned_or_licensed", performer: input.performer, brands: "none", publicFigures: "none" };
}

export async function byteBackedIdentityReference(asset, { fetchBytes, digest, dimensions }) {
  if (!asset || asset.kind !== "image" || asset.role !== "reference" || !asset.downloadUrl) throw new TypeError("请选择当前作品中已上传的图片参考素材");
  const response = await fetchBytes(asset.downloadUrl);
  if (!response.ok) throw new TypeError("无法读取所选参考图的真实字节");
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength) throw new TypeError("所选参考图没有可验证字节");
  const [{ width, height }, sha256] = await Promise.all([dimensions(new Blob([bytes], { type: asset.mimeType })), digest(bytes).then(hex)]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 256 || height < 256) throw new TypeError("参考图实际尺寸必须至少为 256×256");
  return { width, height, sha256 };
}
