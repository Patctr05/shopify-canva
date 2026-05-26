const express = require('express');
const { Liquid } = require('liquidjs');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Setup LiquidJS engine
const engine = new Liquid({
  root: [
    path.resolve(__dirname),
    path.resolve(__dirname, 'layout'),
    path.resolve(__dirname, 'sections'),
    path.resolve(__dirname, 'snippets'),
    path.resolve(__dirname, 'templates')
  ],
  extname: '.liquid',
  cache: false // Disable cache so edits to theme files are reflected instantly on reload
});

// Load locales
const localesPath = path.resolve(__dirname, 'locales/en.default.json');
let locales = {};
if (fs.existsSync(localesPath)) {
  try {
    locales = JSON.parse(fs.readFileSync(localesPath, 'utf8'));
  } catch (e) {
    console.error('Error loading locales:', e);
  }
}

// Translate helper
function getTranslation(key, params) {
  let value = key.split('.').reduce((obj, k) => obj && obj[k], locales);
  if (!value) return key;

  // Handle pluralization objects (e.g. { one: '...', other: '...' })
  if (typeof value === 'object') {
    if (params && params.count !== undefined) {
      const count = Number(params.count);
      if (count === 1 && value.one) {
        value = value.one;
      } else {
        value = value.other || value.many || Object.values(value)[0] || '';
      }
    } else {
      value = value.other || Object.values(value)[0] || '';
    }
  }

  if (typeof value !== 'string') {
    value = String(value);
  }

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), v);
    }
  }
  return value;
}

// Hex color parser for theme settings color schemes
function hexToRgb(hex) {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    red: parseInt(result[1], 16),
    green: parseInt(result[2], 16),
    blue: parseInt(result[3], 16)
  } : null;
}

class ShopifyColor {
  constructor(hex) {
    this.hex = hex;
    const rgb = hexToRgb(hex) || { red: 255, green: 255, blue: 255 };
    this.red = rgb.red;
    this.green = rgb.green;
    this.blue = rgb.blue;
  }
  get rgb() {
    return `${this.red} ${this.green} ${this.blue}`;
  }
  get r() { return this.red; }
  get g() { return this.green; }
  get b() { return this.blue; }
  toString() {
    return this.hex;
  }
}

function processSettings(obj) {
  if (!obj) return obj;
  if (typeof obj === 'string') {
    if (obj.startsWith('#') && (obj.length === 4 || obj.length === 7)) {
      return new ShopifyColor(obj);
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(processSettings);
  }
  if (typeof obj === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(obj)) {
      res[k] = processSettings(v);
    }
    return res;
  }
  return obj;
}

// Register custom filters
engine.registerFilter('asset_url', (value) => `/assets/${value}`);
engine.registerFilter('stylesheet_tag', (value) => `<link rel="stylesheet" href="${value}">`);
engine.registerFilter('script_tag', (value) => `<script src="${value}" defer="defer"></script>`);
engine.registerFilter('t', (key, params) => getTranslation(key, params));
engine.registerFilter('image_url', (image, options) => {
  if (!image) return 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?q=80&w=600&auto=format&fit=crop';
  if (typeof image === 'string') return image;
  return image.url || 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?q=80&w=600&auto=format&fit=crop';
});
engine.registerFilter('image_tag', (url, options) => {
  const classes = options?.class || '';
  const sizes = options?.sizes || '';
  const alt = options?.alt || '';
  return `<img src="${url}" class="${classes}" alt="${alt}" sizes="${sizes}">`;
});
engine.registerFilter('placeholder_svg_tag', (name, className) => {
  return `<div class="${className}" style="background:#e2e8f0;width:100%;height:300px;display:flex;align-items:center;justify-content:center;color:#475569;font-weight:bold;">SVG Placeholder: ${name}</div>`;
});
engine.registerFilter('inline_asset_content', (filename) => {
  const assetPath = path.resolve(__dirname, 'assets', filename);
  if (fs.existsSync(assetPath)) {
    return fs.readFileSync(assetPath, 'utf8');
  }
  return '';
});
engine.registerFilter('escape', (value) => {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
});
engine.registerFilter('divided_by', (value, divisor) => Number(value) / Number(divisor));
engine.registerFilter('times', (value, multiplier) => Number(value) * Number(multiplier));
engine.registerFilter('plus', (value, addition) => Number(value) + Number(addition));
engine.registerFilter('minus', (value, subtraction) => Number(value) - Number(subtraction));
engine.registerFilter('at_most', (value, max) => Math.min(Number(value), Number(max)));
engine.registerFilter('at_least', (value, min) => Math.max(Number(value), Number(min)));
engine.registerFilter('round', (value) => Math.round(Number(value)));
engine.registerFilter('font_face', () => '');
engine.registerFilter('font_modify', (font) => font);
engine.registerFilter('font_url', () => '');
engine.registerFilter('color_brightness', () => 128);
engine.registerFilter('color_lighten', (color) => color);
engine.registerFilter('color_darken', (color) => color);

// Register Custom Tags
engine.registerTag('style', {
  parse: function(tagToken, remainTokens) {
    this.templates = [];
    const stream = this.liquid.parser.parseStream(remainTokens);
    stream
      .on('template', (tpl) => this.templates.push(tpl))
      .on('tag:endstyle', () => stream.stop())
      .on('end', () => { throw new Error(`tag style not closed`); });
    stream.start();
  },
  render: function* (ctx, emitter) {
    emitter.write('<style>');
    yield this.liquid.renderer.renderTemplates(this.templates, ctx, emitter);
    emitter.write('</style>');
  }
});

engine.registerTag('paginate', {
  parse: function(tagToken, remainTokens) {
    this.templates = [];
    const stream = this.liquid.parser.parseStream(remainTokens);
    stream
      .on('template', (tpl) => this.templates.push(tpl))
      .on('tag:endpaginate', () => stream.stop())
      .on('end', () => { throw new Error(`tag paginate not closed`); });
    stream.start();
  },
  render: function* (ctx, emitter) {
    ctx.push({
      paginate: {
        current_page: 1,
        pages: 1,
        items: 4,
        page_size: 4
      }
    });
    yield this.liquid.renderer.renderTemplates(this.templates, ctx, emitter);
    ctx.pop();
  }
});

engine.registerTag('form', {
  parse: function(tagToken, remainTokens) {
    this.args = tagToken.args;
    this.templates = [];
    const stream = this.liquid.parser.parseStream(remainTokens);
    stream
      .on('template', (tpl) => this.templates.push(tpl))
      .on('tag:endform', () => stream.stop())
      .on('end', () => { throw new Error(`tag form not closed`); });
    stream.start();
  },
  render: function* (ctx, emitter) {
    let idAttr = '';
    let classAttr = '';
    const idMatch = this.args.match(/id:\s*['"]([^'"]+)['"]/);
    if (idMatch) idAttr = ` id="${idMatch[1]}"`;
    const classMatch = this.args.match(/class:\s*['"]([^'"]+)['"]/);
    if (classMatch) classAttr = ` class="${classMatch[1]}"`;
    
    emitter.write(`<form${idAttr}${classAttr} action="#" method="post">`);
    ctx.push({ form: { posted_successfully: false, errors: [] } });
    yield this.liquid.renderer.renderTemplates(this.templates, ctx, emitter);
    ctx.pop();
    emitter.write('</form>');
  }
});

engine.registerFilter('payment_terms', () => '<div class="shopify-payment-terms">Mock Payment Terms</div>');

const registerEmptyTag = (name) => {
  engine.registerTag(name, {
    parse: function(tagToken, remainTokens) {
      const stream = this.liquid.parser.parseStream(remainTokens);
      stream.on(`tag:end${name}`, () => stream.stop()).on('end', () => {});
      stream.start();
    },
    render: () => ''
  });
};
registerEmptyTag('schema');
registerEmptyTag('stylesheet');
registerEmptyTag('javascript');

// Custom sections tag for header-group / footer-group JSON rendering
engine.registerTag('sections', {
  parse: function(tagToken) {
    this.groupName = tagToken.args.trim().replace(/['"]/g, '');
  },
  render: async function(ctx, emitter) {
    const groupPath = path.resolve(__dirname, `sections/${this.groupName}.json`);
    if (!fs.existsSync(groupPath)) {
      console.warn(`Sections group file not found: ${groupPath}`);
      return;
    }
    try {
      const groupData = JSON.parse(fs.readFileSync(groupPath, 'utf8'));
      const sections = groupData.sections || {};
      const order = groupData.order || [];

      for (const sectionId of order) {
        const secConfig = sections[sectionId];
        if (!secConfig) continue;
        const html = await renderSection(sectionId, secConfig, ctx.environments);
        emitter.write(html);
      }
    } catch (err) {
      console.error(`Error rendering sections group ${this.groupName}:`, err);
    }
  }
});

// Helper to render a specific section template using config
async function renderSection(sectionId, secConfig, parentContext) {
  const sectionPath = path.resolve(__dirname, `sections/${secConfig.type}.liquid`);
  if (!fs.existsSync(sectionPath)) {
    console.warn(`Section file not found: ${sectionPath}`);
    return `<div style="padding: 20px; border: 1px dashed red; text-align: center; color: red;">Section not found: ${secConfig.type}</div>`;
  }

  try {
    const liquidSource = fs.readFileSync(sectionPath, 'utf8');
    
    // Map blocks dictionary into ordered blocks array
    const blocksArray = [];
    if (secConfig.blocks && secConfig.block_order) {
      for (const bId of secConfig.block_order) {
        const b = secConfig.blocks[bId];
        if (b) {
          blocksArray.push({
            id: bId,
            type: b.type,
            settings: b.settings || {},
            shopify_attributes: ''
          });
        }
      }
    }

    // Resolve any schema strings to context values (e.g. collection settings)
    const resolvedSettings = { ...secConfig.settings };
    for (const [k, v] of Object.entries(resolvedSettings)) {
      if (typeof v === 'string' && parentContext.collections && parentContext.collections[v]) {
        resolvedSettings[k] = parentContext.collections[v];
      }
    }

    const sectionContext = {
      ...parentContext,
      section: {
        id: sectionId,
        settings: resolvedSettings,
        blocks: blocksArray,
        index: 1
      }
    };

    const html = await engine.parseAndRender(liquidSource, sectionContext);
    return `<div id="shopify-section-${sectionId}" class="shopify-section">${html}</div>`;
  } catch (err) {
    console.error(`Error rendering section ${sectionId} (${secConfig.type}):`, err);
    return `<div style="padding: 20px; background: #fee2e2; color: #991b1b; border: 1px solid #f87171; font-family: monospace;">
      <strong>Error in Section ${secConfig.type}:</strong>
      <pre style="margin-top: 10px; font-size: 12px; overflow: auto; white-space: pre-wrap;">${err.message}</pre>
    </div>`;
  }
}

// Global Mock Data for Shopify Environment
let mockProducts = [
  {
    id: 1,
    title: "Eco-Friendly Leather Boot",
    handle: "eco-friendly-leather-boot",
    url: "/products/eco-friendly-leather-boot",
    vendor: "Urban Outfitters",
    price: 12000,
    compare_at_price: 15000,
    available: true,
    featured_image: {
      url: "https://images.unsplash.com/photo-1520639888713-7851133b1ed0?q=80&w=600&auto=format&fit=crop",
      aspect_ratio: 1.0,
      width: 600
    },
    featured_media: {
      url: "https://images.unsplash.com/photo-1520639888713-7851133b1ed0?q=80&w=600&auto=format&fit=crop",
      aspect_ratio: 1.0,
      width: 600
    },
    images: [
      "https://images.unsplash.com/photo-1520639888713-7851133b1ed0?q=80&w=600&auto=format&fit=crop"
    ],
    variants: [{ id: 101, title: "Black / 9", price: 12000, compare_at_price: 15000, available: true }],
    selected_or_first_available_variant: { id: 101, title: "Black / 9", price: 12000, compare_at_price: 15000, available: true },
    options_with_values: [{ name: "Color", values: ["Black", "Brown"] }, { name: "Size", values: ["9", "10", "11"] }],
    description: "Handcrafted from responsibly sourced leather. Designed for ultimate durability, style, and everyday comfort.",
    content: "Handcrafted from responsibly sourced leather. Designed for ultimate durability, style, and everyday comfort."
  },
  {
    id: 2,
    title: "Minimalist Linen Shirt",
    handle: "minimalist-linen-shirt",
    url: "/products/minimalist-linen-shirt",
    vendor: "Studio Standard",
    price: 4500,
    compare_at_price: null,
    available: true,
    featured_image: {
      url: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?q=80&w=600&auto=format&fit=crop",
      aspect_ratio: 0.75,
      width: 600
    },
    featured_media: {
      url: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?q=80&w=600&auto=format&fit=crop",
      aspect_ratio: 0.75,
      width: 600
    },
    images: [
      "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?q=80&w=600&auto=format&fit=crop"
    ],
    variants: [{ id: 201, title: "Default Title", price: 4500, compare_at_price: null, available: true }],
    selected_or_first_available_variant: { id: 201, title: "Default Title", price: 4500, compare_at_price: null, available: true },
    options_with_values: [{ name: "Color", values: ["White", "Beige"] }],
    description: "Super light and airy linen shirt. Fits relaxed and keeps you cool through hot days.",
    content: "Super light and airy linen shirt. Fits relaxed and keeps you cool through hot days."
  },
  {
    id: 3,
    title: "Handmade Ceramic Mug",
    handle: "handmade-ceramic-mug",
    url: "/products/handmade-ceramic-mug",
    vendor: "Clay & Co",
    price: 2400,
    compare_at_price: 3000,
    available: true,
    featured_image: {
      url: "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?q=80&w=600&auto=format&fit=crop",
      aspect_ratio: 1.0,
      width: 600
    },
    featured_media: {
      url: "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?q=80&w=600&auto=format&fit=crop",
      aspect_ratio: 1.0,
      width: 600
    },
    images: [
      "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?q=80&w=600&auto=format&fit=crop"
    ],
    variants: [{ id: 301, title: "Default Title", price: 2400, compare_at_price: 3000, available: true }],
    selected_or_first_available_variant: { id: 301, title: "Default Title", price: 2400, compare_at_price: 3000, available: true },
    options_with_values: [{ name: "Color", values: ["Natural", "Blue Speckle"] }],
    description: "An organically shaped, heavy-bottom ceramic mug that makes morning coffee feel special.",
    content: "An organically shaped, heavy-bottom ceramic mug that makes morning coffee feel special."
  },
  {
    id: 4,
    title: "Organic Wool Knit Beanie",
    handle: "organic-wool-knit-beanie",
    url: "/products/organic-wool-knit-beanie",
    vendor: "Peak Gear",
    price: 1800,
    compare_at_price: null,
    available: true,
    featured_image: {
      url: "https://images.unsplash.com/photo-1576871337632-b9aef4c17ab9?q=80&w=600&auto=format&fit=crop",
      aspect_ratio: 1.0,
      width: 600
    },
    featured_media: {
      url: "https://images.unsplash.com/photo-1576871337632-b9aef4c17ab9?q=80&w=600&auto=format&fit=crop",
      aspect_ratio: 1.0,
      width: 600
    },
    images: [
      "https://images.unsplash.com/photo-1576871337632-b9aef4c17ab9?q=80&w=600&auto=format&fit=crop"
    ],
    variants: [{ id: 401, title: "Default Title", price: 1800, compare_at_price: null, available: true }],
    selected_or_first_available_variant: { id: 401, title: "Default Title", price: 1800, compare_at_price: null, available: true },
    options_with_values: [{ name: "Color", values: ["Charcoal", "Mustard"] }],
    description: "Soft, warm, and highly stretchable ribbed beanie knitted from 100% organic merino wool.",
    content: "Soft, warm, and highly stretchable ribbed beanie knitted from 100% organic merino wool."
  }
];

let mockCollections = {
  all: {
    title: "All Products",
    url: "/collections/all",
    products: mockProducts,
    all_products_count: mockProducts.length,
    description: "Our complete range of high-quality products."
  }
};

function getGlobalSettings() {
  const settingsPath = path.resolve(__dirname, 'config/settings_data.json');
  if (!fs.existsSync(settingsPath)) return {};
  try {
    const settingsData = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const currentPreset = settingsData.current || Object.keys(settingsData.presets)[0];
    const rawSettings = settingsData.presets[currentPreset] || {};
    
    // Transform color_schemes into an array of { id, settings } to match Shopify's iterator behavior in LiquidJS
    if (rawSettings.color_schemes) {
      const schemesArray = [];
      for (const [id, value] of Object.entries(rawSettings.color_schemes)) {
        schemesArray.push({
          id: id,
          settings: value.settings || {}
        });
      }
      rawSettings.color_schemes = schemesArray;
    }
    
    return processSettings(rawSettings);
  } catch (e) {
    console.error('Error loading global settings:', e);
    return {};
  }
}

// Serve Shopify assets folder
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Helper to inject dev console in served HTML response
function injectDevConsole(html, activePageName, templateJsonPath) {
  const absoluteTemplatePath = `file:///${templateJsonPath.replace(/\\/g, '/')}`;
  const devConsole = `
  <div id="shopify-dev-console" style="position:fixed;bottom:20px;right:20px;background:rgba(24,28,38,0.96);color:#e2e8f0;padding:16px;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.4);z-index:99999;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,Cantarell,sans-serif;width:320px;backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.08);box-sizing:border-box;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:8px;">
      <span style="font-weight:700;color:#6366f1;display:flex;align-items:center;gap:6px;font-size:14px;">
        <svg style="width:16px;height:16px;" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
        Shopify Local Project
      </span>
      <span style="font-size:10px;background:#10b981;color:#fff;padding:2px 6px;border-radius:4px;font-weight:700;letter-spacing:0.5px;">ACTIVE</span>
    </div>
    <div style="font-size:12px;margin-bottom:12px;color:#94a3b8;line-height:1.4;">
      Modify the JSON file in your IDE to see live updates on refresh!
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;">
      <a href="/" style="text-decoration:none;color:${activePageName === 'index' ? '#fff' : '#94a3b8'};padding:8px 12px;background:${activePageName === 'index' ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.03)'};border:1px solid ${activePageName === 'index' ? 'rgba(99,102,241,0.3)' : 'transparent'};border-radius:6px;font-size:12px;display:flex;align-items:center;justify-content:space-between;transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.background='${activePageName === 'index' ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.03)'}'">
        <span>🏠 Home page</span>
        <span style="font-size:10px;color:#6366f1;">index.json</span>
      </a>
      <a href="/products/eco-friendly-leather-boot" style="text-decoration:none;color:${activePageName === 'product' ? '#fff' : '#94a3b8'};padding:8px 12px;background:${activePageName === 'product' ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.03)'};border:1px solid ${activePageName === 'product' ? 'rgba(99,102,241,0.3)' : 'transparent'};border-radius:6px;font-size:12px;display:flex;align-items:center;justify-content:space-between;transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.background='${activePageName === 'product' ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.03)'}'">
        <span>🛍️ Product details</span>
        <span style="font-size:10px;color:#6366f1;">product.json</span>
      </a>
    </div>
    <div style="margin-top:12px;border-top:1px solid rgba(255,255,255,0.08);padding-top:10px;">
      <div style="font-size:10px;color:#64748b;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">ACTIVE TEMPLATE FILE</div>
      <a href="${absoluteTemplatePath}" style="font-size:11px;font-family:Consolas, Monaco, monospace;background:#0f172a;color:#38bdf8;padding:6px;border-radius:4px;word-break:break-all;display:block;text-decoration:none;border:1px solid rgba(255,255,255,0.05);transition:border-color 0.2s;" onmouseover="this.style.borderColor='#38bdf8'" onmouseout="this.style.borderColor='rgba(255,255,255,0.05)'">
        templates/${activePageName}.json
      </a>
    </div>
  </div>
  `;
  return html.replace('</body>', `${devConsole}</body>`);
}

// Router paths
app.get('/', async (req, res) => {
  try {
    const globalContext = {
      settings: getGlobalSettings(),
      collections: mockCollections,
      cart: {
        item_count: 0,
        items: [],
        total_price: 0
      },
      request: { locale: { iso_code: 'en' } },
      canonical_url: 'http://localhost:3000/',
      page_title: 'My Local Shopify Store',
      page_description: 'Welcome to your custom local Shopify theme development preview.',
      content_for_header: '<!-- mock content_for_header -->',
      theme: { name: 'Dawn' }
    };

    const contentForLayout = await renderPage('index', globalContext);
    
    const layoutContext = {
      ...globalContext,
      content_for_layout: contentForLayout
    };

    let html = await engine.renderFile('theme', layoutContext);
    
    // Inject dev console overlay
    html = injectDevConsole(html, 'index', path.join(__dirname, 'templates/index.json'));

    res.send(html);
  } catch (err) {
    res.status(500).send(`<h1>Theme Rendering Error</h1><pre>${err.stack}</pre>`);
  }
});

app.get('/products/:handle', async (req, res) => {
  try {
    const product = mockProducts.find(p => p.handle === req.params.handle) || mockProducts[0];
    const globalContext = {
      settings: getGlobalSettings(),
      collections: mockCollections,
      product: product,
      cart: {
        item_count: 0,
        items: [],
        total_price: 0
      },
      request: { locale: { iso_code: 'en' } },
      canonical_url: `http://localhost:3000/products/${product.handle}`,
      page_title: `${product.title} - Local Store`,
      page_description: product.description,
      content_for_header: '<!-- mock content_for_header -->',
      theme: { name: 'Dawn' }
    };

    const contentForLayout = await renderPage('product', globalContext);
    
    const layoutContext = {
      ...globalContext,
      content_for_layout: contentForLayout
    };

    let html = await engine.renderFile('theme', layoutContext);
    
    html = injectDevConsole(html, 'product', path.join(__dirname, 'templates/product.json'));

    res.send(html);
  } catch (err) {
    res.status(500).send(`<h1>Theme Rendering Error</h1><pre>${err.stack}</pre>`);
  }
});

app.get('/collections/:handle', async (req, res) => {
  try {
    const handle = req.params.handle;
    const collection = mockCollections[handle] || {
      title: handle.charAt(0).toUpperCase() + handle.slice(1).replace(/-/g, ' ') + " Collection",
      url: `/collections/${handle}`,
      products: mockProducts,
      all_products_count: mockProducts.length,
      description: `Browse all products in our custom ${handle} collection.`
    };

    const globalContext = {
      settings: getGlobalSettings(),
      collections: mockCollections,
      collection: collection,
      cart: {
        item_count: 0,
        items: [],
        total_price: 0
      },
      request: { locale: { iso_code: 'en' } },
      canonical_url: `http://localhost:3000/collections/${handle}`,
      page_title: `${collection.title} - Local Store`,
      page_description: collection.description,
      content_for_header: '<!-- mock content_for_header -->',
      theme: { name: 'Dawn' }
    };

    const contentForLayout = await renderPage('collection', globalContext);
    
    const layoutContext = {
      ...globalContext,
      content_for_layout: contentForLayout
    };

    let html = await engine.renderFile('theme', layoutContext);
    
    html = injectDevConsole(html, 'collection', path.join(__dirname, 'templates/collection.json'));

    res.send(html);
  } catch (err) {
    res.status(500).send(`<h1>Theme Rendering Error</h1><pre>${err.stack}</pre>`);
  }
});

async function fetchLiveProducts() {
  try {
    const response = await fetch('https://gp0hf1-ca.myshopify.com/products.json');
    const data = await response.json();
    if (data && data.products && data.products.length > 0) {
      const mapped = data.products.map(p => {
        const isTShirt = p.title.toLowerCase().includes('shirt') || p.title.toLowerCase().includes('tee') || p.handle.toLowerCase().includes('shirt') || p.handle.toLowerCase().includes('tee');
        let firstImage = p.images && p.images[0];
        if (isTShirt && p.images) {
          const backImg = p.images.find(img => img.src && img.src.toLowerCase().includes('back'));
          if (backImg) {
            firstImage = backImg;
          }
        }
        const featured_image = firstImage ? {
          url: firstImage.src,
          aspect_ratio: (firstImage.width && firstImage.height) ? (firstImage.width / firstImage.height) : 1.0,
          width: firstImage.width || 800,
          height: firstImage.height || 800
        } : {
          url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?q=80&w=600&auto=format&fit=crop",
          aspect_ratio: 1.0,
          width: 600,
          height: 600
        };

        const imagesList = p.images ? p.images.map(img => img.src) : [featured_image.url];

        const variants = p.variants ? p.variants.map(v => {
          const priceCents = Math.round(parseFloat(v.price) * 100);
          const compareAtCents = v.compare_at_price ? Math.round(parseFloat(v.compare_at_price) * 100) : null;
          return {
            id: v.id,
            title: v.title,
            price: priceCents,
            compare_at_price: compareAtCents,
            available: true
          };
        }) : [];

        const selectedVariant = variants[0] || { id: p.id, title: "Default Title", price: 0, compare_at_price: null, available: false };

        const options_with_values = p.options ? p.options.map(opt => ({
          name: opt.name,
          values: opt.values
        })) : [];

        let cleanedHtml = p.body_html || "";
        cleanedHtml = cleanedHtml.replace(/<h3><span>Breaking News:.*?great deal\.<\/span><\/h3>/gi, '');
        cleanedHtml = cleanedHtml.replace(/Breaking News:.*?great deal\./gi, '');
        cleanedHtml = cleanedHtml.trim();

        return {
          id: p.id,
          title: p.title,
          handle: p.handle,
          url: `/products/${p.handle}`,
          vendor: p.vendor,
          price: selectedVariant.price,
          compare_at_price: selectedVariant.compare_at_price,
          available: selectedVariant.available,
          featured_image: featured_image,
          featured_media: featured_image,
          images: imagesList,
          variants: variants,
          selected_or_first_available_variant: selectedVariant,
          options_with_values: options_with_values,
          description: cleanedHtml,
          content: cleanedHtml
        };
      });

      // Sort products: Men's T-Shirts first (Ben-Jlo then Mailbox then others), then Women's T-Shirts, then other products
      mapped.sort((a, b) => {
        const titleA = a.title.toLowerCase();
        const titleB = b.title.toLowerCase();
        
        const isTShirtA = titleA.includes('t-shirt') || titleA.includes('tee');
        const isTShirtB = titleB.includes('t-shirt') || titleB.includes('tee');
        
        const isMensA = titleA.includes('men');
        const isMensB = titleB.includes('men');
        
        const isWomansA = titleA.includes('woman') || titleA.includes('women');
        const isWomansB = titleB.includes('woman') || titleB.includes('women');
        
        if (isTShirtA && !isTShirtB) return -1;
        if (!isTShirtA && isTShirtB) return 1;
        
        if (isTShirtA && isTShirtB) {
          if (isMensA && !isMensB) return -1;
          if (!isMensA && isMensB) return 1;
          if (isWomansA && !isWomansB && !isMensB) return -1;
          if (!isWomansA && isWomansB && !isMensA) return 1;
          
          const isBenJloA = titleA.includes('ben-jlo') || titleA.includes('benjlo');
          const isBenJloB = titleB.includes('ben-jlo') || titleB.includes('benjlo');
          if (isBenJloA && !isBenJloB) return -1;
          if (!isBenJloA && isBenJloB) return 1;
          
          const isMailboxA = titleA.includes('mailbox');
          const isMailboxB = titleB.includes('mailbox');
          if (isMailboxA && !isMailboxB) return -1;
          if (!isMailboxA && isMailboxB) return 1;
        }
        
        return 0;
      });

      mockProducts = mapped;
      mockCollections.all.products = mapped;
      mockCollections.all.all_products_count = mapped.length;
      console.log(`\n✅ Loaded ${mapped.length} products from gp0hf1-ca.myshopify.com`);
    }
  } catch (err) {
    console.error('Error fetching live products, falling back to mock data:', err.message);
  }
}

// Run server
app.listen(PORT, async () => {
  await fetchLiveProducts();
  console.log(`\n🚀 Shopify rendering server running locally!`);
  const firstProductHandle = mockProducts[0] ? mockProducts[0].handle : 'eco-friendly-leather-boot';
  console.log(`👉 Preview Home:    http://localhost:${PORT}`);
  console.log(`👉 Preview Product: http://localhost:${PORT}/products/${firstProductHandle}\n`);
});

// Render dynamic templates helper
async function renderPage(templateName, globalContext) {
  const templatePath = path.resolve(__dirname, `templates/${templateName}.json`);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template file templates/${templateName}.json not found`);
  }
  
  const templateData = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  const sections = templateData.sections || {};
  const order = templateData.order || [];
  
  let contentForLayout = '';
  for (const sectionId of order) {
    const secConfig = sections[sectionId];
    if (!secConfig) continue;
    const html = await renderSection(sectionId, secConfig, globalContext);
    contentForLayout += html;
  }
  
  return contentForLayout;
}
