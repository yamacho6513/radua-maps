const { execFileSync } = require("child_process");
const fs = require("fs");

const SHOP_URL = "https://shelter2.com";
const LIMIT = 50;

function xmlEscape(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stripHtml(html = "") {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<\/div>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTableValue(html = "", label = "") {
  const text = String(html);
  const pattern = new RegExp(
    `<th[^>]*>\\s*${label}\\s*<\\/th>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`,
    "i"
  );

  const match = text.match(pattern);
  if (!match) return "";

  return stripHtml(match[1]);
}

function getOptionValue(variant, names) {
  for (const opt of [variant?.option1, variant?.option2]) {
    if (!opt) continue;

    const name = String(opt.name || "").toLowerCase();

    if (names.some(n => name.includes(n))) {
      return opt.value || "";
    }
  }

  return "";
}

function fetchProducts() {
  let offset = 0;
  let all = [];

  while (true) {
    console.log(`商品取得中... offset=${offset}`);

    const stdout = execFileSync(
      "colorme",
      [
        "api",
        "/v1/products",
        "--query",
        `limit=${LIMIT}&offset=${offset}`
      ],
      {
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024
      }
    );

    const json = JSON.parse(stdout);

    all = all.concat(json.products || []);

    const total = json.meta?.total || 0;
    offset += LIMIT;

    if (offset >= total) break;
  }

  return all;
}

function makeItem(product, variant = null) {
  const html =
    product.expl ||
    product.smartphone_expl ||
    product.simple_expl ||
    "";

  const brand = extractTableValue(html, "ブランド");
  const productCode =
    extractTableValue(html, "品番") ||
    variant?.model_number ||
    product.model_number ||
    "";

  const color = variant
    ? getOptionValue(variant, ["color", "colour", "カラー", "色"])
    : "";

  const size = variant
    ? getOptionValue(variant, ["size", "サイズ"])
    : "";

  const stock = variant
    ? variant.stocks
    : product.stocks;

  const price = variant?.option_price_including_tax
    ?? product.sales_price_including_tax
    ?? product.sales_price
    ?? product.price;

  const variantId = variant
    ? `${product.id}-${variant.id}`
    : String(product.id);

  const titleParts = [
    brand,
    product.name,
    color,
    size
  ].filter(Boolean);

  const title = titleParts.join(" ");

  const description =
    stripHtml(html) ||
    title;

  const image = product.image_url;

  let xml = `
    <item>
      <g:id>${xmlEscape(variantId)}</g:id>
      <g:title>${xmlEscape(title)}</g:title>
      <g:description>${xmlEscape(description)}</g:description>
      <g:link>${xmlEscape(`${SHOP_URL}/?pid=${product.id}`)}</g:link>
      <g:image_link>${xmlEscape(image)}</g:image_link>
      <g:availability>${stock !== null && stock <= 0 ? "out_of_stock" : "in_stock"}</g:availability>
      <g:condition>new</g:condition>
      <g:price>${xmlEscape(price)} JPY</g:price>`;

  if (brand) {
    xml += `
      <g:brand>${xmlEscape(brand)}</g:brand>`;
  }

  if (productCode) {
    xml += `
      <g:mpn>${xmlEscape(productCode)}</g:mpn>`;
  } else {
    xml += `
      <g:identifier_exists>false</g:identifier_exists>`;
  }

  if (variant) {
    xml += `
      <g:item_group_id>${xmlEscape(product.id)}</g:item_group_id>`;
  }

  if (color) {
    xml += `
      <g:color>${xmlEscape(color)}</g:color>`;
  }

  if (size) {
    xml += `
      <g:size>${xmlEscape(size)}</g:size>`;
  }

  const extraImages = (product.images || [])
    .map(img => img.src || img.url)
    .filter(Boolean)
    .slice(0, 10);

  for (const img of extraImages) {
    xml += `
      <g:additional_image_link>${xmlEscape(img)}</g:additional_image_link>`;
  }

  xml += `
    </item>`;

  return xml;
}

function main() {
  const products = fetchProducts();

  console.log(`取得商品数: ${products.length}`);

  const eligible = products.filter(product => {
    // Google掲載に最低限必要な画像・価格がある通常商品だけ対象
    return (
      product.display_state === "showing" &&
      product.image_url &&
      (product.sales_price_including_tax || product.sales_price || product.price)
    );
  });

  const items = [];

  for (const product of eligible) {
    if (Array.isArray(product.variants) && product.variants.length > 0) {
      for (const variant of product.variants) {
        items.push(makeItem(product, variant));
      }
    } else {
      items.push(makeItem(product));
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>SHELTER2 Product Feed</title>
    <link>${SHOP_URL}</link>
    <description>SHELTER2 Google Merchant Center Product Feed</description>
${items.join("\n")}
  </channel>
</rss>
`;

  fs.writeFileSync("merchant-feed.xml", xml, "utf8");

  console.log("");
  console.log("=================================");
  console.log("Google Merchant Feed 作成完了");
  console.log(`元商品数: ${products.length}`);
  console.log(`対象商品数: ${eligible.length}`);
  console.log(`Google送信アイテム数: ${items.length}`);
  console.log("出力: merchant-feed.xml");
  console.log("=================================");
}

main();
