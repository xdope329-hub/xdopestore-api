require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const slugify = require('slugify');

const Role        = require('../src/models/Role');
const User        = require('../src/models/User');
const Attachment  = require('../src/models/Attachment');
const Category    = require('../src/models/Category');
const Brand       = require('../src/models/Brand');
const Attribute   = require('../src/models/Attribute');
const Tax         = require('../src/models/Tax');
const Product     = require('../src/models/Product');
const OrderStatus = require('../src/models/OrderStatus');
const Order       = require('../src/models/Order');
const Coupon      = require('../src/models/Coupon');
const Shipping    = require('../src/models/Shipping');
const Blog        = require('../src/models/Blog');
const Review      = require('../src/models/Review');
const Wishlist    = require('../src/models/Wishlist');
const Cart        = require('../src/models/Cart');
const Setting     = require('../src/models/Setting');
const Notification= require('../src/models/Notification');
const Homepage    = require('../src/models/Homepage');
const ThemeOption = require('../src/models/ThemeOption');
const Menu        = require('../src/models/Menu');
const Tag         = require('../src/models/Tag');

const sl = s => slugify(s, { lower: true, strict: true });
const img = (seed, w = 600, h = 600) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

async function att(seed, w = 600, h = 600, label = seed) {
  return Attachment.create({
    name: `${label}.jpg`,
    file_name: `${label}.jpg`,
    mime_type: 'image/jpeg',
    original_url: img(seed, w, h),
    asset_url: img(seed, w, h),
  });
}

function variation(name, attrValues, price, salePx, qty, sku) {
  return {
    name,
    attribute_values: attrValues,
    price,
    sale_price: salePx || null,
    discount: salePx ? Math.round((1 - salePx / price) * 100) : null,
    quantity: qty,
    sku,
    stock_status: qty > 0 ? 'in_stock' : 'out_of_stock',
    status: 1,
  };
}

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado a MongoDB');

  for (const col of Object.values(mongoose.connection.collections)) {
    await col.deleteMany({});
  }
  console.log('Colecciones limpiadas');

  // ── 1. Roles ────────────────────────────────────────────────────────────────
  const [adminRole, consumerRole] = await Role.insertMany([
    { name: 'admin',    system_reserve: '1' },
    { name: 'consumer', system_reserve: '0' },
  ]);

  // ── 2. Estados de Pedido ────────────────────────────────────────────────────
  const orderStatuses = await OrderStatus.insertMany([
    { name: 'Pendiente',       slug: 'pending',          sequence: 1, color: '#f59e0b', system_reserve: '1' },
    { name: 'Procesando',      slug: 'processing',       sequence: 2, color: '#3b82f6', system_reserve: '0' },
    { name: 'Enviado',         slug: 'shipped',          sequence: 3, color: '#8b5cf6', system_reserve: '0' },
    { name: 'En Camino',       slug: 'out_for_delivery', sequence: 4, color: '#06b6d4', system_reserve: '0' },
    { name: 'Entregado',       slug: 'delivered',        sequence: 5, color: '#10b981', system_reserve: '1' },
    { name: 'Cancelado',       slug: 'cancelled',        sequence: 6, color: '#ef4444', system_reserve: '1' },
  ]);
  const ST = slug => orderStatuses.find(s => s.slug === slug);

  // ── 3. Usuarios ─────────────────────────────────────────────────────────────
  const adminUser = await User.create({
    name: 'Super Admin',
    email: process.env.ADMIN_EMAIL || 'admin@xdope.com',
    password: process.env.ADMIN_PASSWORD || 'Admin@123',
    role: adminRole._id,
    status: 1, system_reserve: '1',
    email_verified_at: new Date(),
  });
  const consumerUser = await User.create({
    name: 'Isabella Martínez',
    email: 'isabella@xdope.com',
    password: 'Consumer@123',
    role: consumerRole._id,
    status: 1,
    email_verified_at: new Date(),
  });
  // (Wallet creation removed when the consumer wallet feature was retired.)
  console.log(`Usuarios: ${adminUser.email} / ${consumerUser.email}`);

  // ── 4. Configuración ────────────────────────────────────────────────────────
  await Setting.create({
    values: {
      general: {
        site_name: 'XDOPE Store',
        site_tagline: 'Viste tu Estilo',
        site_title: 'XDOPE — Moda de Vanguardia',
        site_url: 'http://localhost:3001',
        copyright: '© 2026 XDOPE Store. Todos los derechos reservados.',
        default_currency: {
          name: 'Peso Colombiano', code: 'COP', symbol: '$',
          symbol_position: 'before_price', exchange_rate: 1,
        },
        default_language: 'es',
        mode: 'light-only',
        admin_site_language_direction: 'ltr',
        front_site_language_direction: 'ltr',
      },
      activation: {
        guest_checkout: true,
        multivendor: false,
        product_auto_approve: true,
        wallet_enable: true,
        coupon_enable: true,
        point_enable: false,
        stock_product_hide: false,
      },
      maintenance: { maintenance_mode: false },
      delivery: {
        estimated_delivery_text: '3–5 días hábiles',
        same_day_delivery: false,
        default: { title: 'Envío estándar', description: '3–5 días hábiles' },
        same_day: { title: 'Entrega el mismo día', description: 'Antes de las 8pm' },
      },
      payment_methods: [
        { name: 'cod', status: 1 },
        { name: 'mercadopago', status: 1 },
      ],
    },
  });

  // ── 5. IVA 19% ──────────────────────────────────────────────────────────────
  const iva = await Tax.create({ name: 'IVA', rate: 19, status: 1 });

  // ── 6. Tags ─────────────────────────────────────────────────────────────────
  await Tag.insertMany([
    { name: 'Verano',            slug: 'verano',            status: 1, type: 'product' },
    { name: 'Nueva Colección',   slug: 'nueva-coleccion',   status: 1, type: 'product' },
    { name: 'Más Vendido',       slug: 'mas-vendido',       status: 1, type: 'product' },
    { name: 'Sostenible',        slug: 'sostenible',        status: 1, type: 'product' },
    { name: 'Edición Limitada',  slug: 'edicion-limitada',  status: 1, type: 'product' },
    { name: 'Guía de Estilo',    slug: 'guia-de-estilo',    status: 1, type: 'blog'    },
    { name: 'Tendencias',        slug: 'tendencias',        status: 1, type: 'blog'    },
    { name: 'Lookbook',          slug: 'lookbook',          status: 1, type: 'blog'    },
  ]);

  // ── 7. Imágenes de categorías ────────────────────────────────────────────────
  const catImgs = {
    women:       await att('women-fashion',      400, 400, 'cat-mujer'),
    men:         await att('men-fashion',        400, 400, 'cat-hombre'),
    kids:        await att('kids-fashion',       400, 400, 'cat-ninos'),
    accessories: await att('fashion-accessories',400, 400, 'cat-accesorios'),
    shoes:       await att('fashion-shoes',      400, 400, 'cat-calzado'),
    sale:        await att('sale-fashion',       400, 400, 'cat-ofertas'),
    dresses:     await att('women-dresses',      400, 400, 'cat-vestidos'),
    tops:        await att('women-tops',         400, 400, 'cat-blusas'),
    pants_w:     await att('women-pants',        400, 400, 'cat-pantalones-mujer'),
    skirts:      await att('women-skirts',       400, 400, 'cat-faldas'),
    outer_w:     await att('women-coats',        400, 400, 'cat-abrigos-mujer'),
    active_w:    await att('women-active',       400, 400, 'cat-deportivo-mujer'),
    tshirts:     await att('men-tshirts',        400, 400, 'cat-camisetas'),
    shirts:      await att('men-shirts',         400, 400, 'cat-camisas'),
    pants_m:     await att('men-pants',          400, 400, 'cat-pantalones-hombre'),
    outer_m:     await att('men-coats',          400, 400, 'cat-abrigos-hombre'),
    active_m:    await att('men-active',         400, 400, 'cat-deportivo-hombre'),
    bags:        await att('fashion-bags',       400, 400, 'cat-bolsos'),
    jewelry:     await att('fashion-jewelry',    400, 400, 'cat-joyeria'),
    hats:        await att('fashion-hats',       400, 400, 'cat-sombreros'),
    shoes_w:     await att('women-shoes',        400, 400, 'cat-calzado-mujer'),
    shoes_m:     await att('men-shoes',          400, 400, 'cat-calzado-hombre'),
  };

  // ── 8. Categorías ────────────────────────────────────────────────────────────
  const cWomen  = await Category.create({ name: 'Mujer',       slug: 'mujer',       type: 'product', status: 1, category_image_id: catImgs.women._id,       created_by_id: adminUser._id });
  const cMen    = await Category.create({ name: 'Hombre',      slug: 'hombre',      type: 'product', status: 1, category_image_id: catImgs.men._id,         created_by_id: adminUser._id });
  const cKids   = await Category.create({ name: 'Niños',       slug: 'ninos',       type: 'product', status: 1, category_image_id: catImgs.kids._id,        created_by_id: adminUser._id });
  const cAcc    = await Category.create({ name: 'Accesorios',  slug: 'accesorios',  type: 'product', status: 1, category_image_id: catImgs.accessories._id, created_by_id: adminUser._id });
  const cShoes  = await Category.create({ name: 'Calzado',     slug: 'calzado',     type: 'product', status: 1, category_image_id: catImgs.shoes._id,       created_by_id: adminUser._id });
  const cSale   = await Category.create({ name: 'Ofertas',     slug: 'ofertas',     type: 'product', status: 1, category_image_id: catImgs.sale._id,        created_by_id: adminUser._id });

  const cDresses = await Category.create({ name: 'Vestidos',              slug: 'vestidos',              type: 'product', status: 1, parent_id: cWomen._id,  category_image_id: catImgs.dresses._id,  created_by_id: adminUser._id });
  const cTops    = await Category.create({ name: 'Blusas y Tops',         slug: 'blusas-y-tops',         type: 'product', status: 1, parent_id: cWomen._id,  category_image_id: catImgs.tops._id,     created_by_id: adminUser._id });
  const cPantsW  = await Category.create({ name: 'Pantalones Mujer',      slug: 'pantalones-mujer',      type: 'product', status: 1, parent_id: cWomen._id,  category_image_id: catImgs.pants_w._id,  created_by_id: adminUser._id });
  const cSkirts  = await Category.create({ name: 'Faldas',                slug: 'faldas',                type: 'product', status: 1, parent_id: cWomen._id,  category_image_id: catImgs.skirts._id,   created_by_id: adminUser._id });
  const cOuterW  = await Category.create({ name: 'Abrigos Mujer',         slug: 'abrigos-mujer',         type: 'product', status: 1, parent_id: cWomen._id,  category_image_id: catImgs.outer_w._id,  created_by_id: adminUser._id });
  const cActiveW = await Category.create({ name: 'Deportivo Mujer',       slug: 'deportivo-mujer',       type: 'product', status: 1, parent_id: cWomen._id,  category_image_id: catImgs.active_w._id, created_by_id: adminUser._id });

  const cTshirts = await Category.create({ name: 'Camisetas',             slug: 'camisetas',             type: 'product', status: 1, parent_id: cMen._id,    category_image_id: catImgs.tshirts._id,  created_by_id: adminUser._id });
  const cShirts  = await Category.create({ name: 'Camisas',               slug: 'camisas',               type: 'product', status: 1, parent_id: cMen._id,    category_image_id: catImgs.shirts._id,   created_by_id: adminUser._id });
  const cPantsM  = await Category.create({ name: 'Pantalones Hombre',     slug: 'pantalones-hombre',     type: 'product', status: 1, parent_id: cMen._id,    category_image_id: catImgs.pants_m._id,  created_by_id: adminUser._id });
  const cOuterM  = await Category.create({ name: 'Abrigos Hombre',        slug: 'abrigos-hombre',        type: 'product', status: 1, parent_id: cMen._id,    category_image_id: catImgs.outer_m._id,  created_by_id: adminUser._id });
  const cActiveM = await Category.create({ name: 'Deportivo Hombre',      slug: 'deportivo-hombre',      type: 'product', status: 1, parent_id: cMen._id,    category_image_id: catImgs.active_m._id, created_by_id: adminUser._id });

  const cBags    = await Category.create({ name: 'Bolsos y Carteras',     slug: 'bolsos-y-carteras',     type: 'product', status: 1, parent_id: cAcc._id,    category_image_id: catImgs.bags._id,     created_by_id: adminUser._id });
  const cJewelry = await Category.create({ name: 'Joyería',               slug: 'joyeria',               type: 'product', status: 1, parent_id: cAcc._id,    category_image_id: catImgs.jewelry._id,  created_by_id: adminUser._id });
  const cHats    = await Category.create({ name: 'Sombreros y Gorras',    slug: 'sombreros-y-gorras',    type: 'product', status: 1, parent_id: cAcc._id,    category_image_id: catImgs.hats._id,     created_by_id: adminUser._id });

  const cShoesW  = await Category.create({ name: 'Calzado Mujer',         slug: 'calzado-mujer',         type: 'product', status: 1, parent_id: cShoes._id,  category_image_id: catImgs.shoes_w._id,  created_by_id: adminUser._id });
  const cShoesM  = await Category.create({ name: 'Calzado Hombre',        slug: 'calzado-hombre',        type: 'product', status: 1, parent_id: cShoes._id,  category_image_id: catImgs.shoes_m._id,  created_by_id: adminUser._id });

  console.log('Categorías creadas');

  // ── 9. Marcas ────────────────────────────────────────────────────────────────
  const brandImgs = await Promise.all([
    att('brand-zara', 200, 80, 'brand-zara'),
    att('brand-hm',   200, 80, 'brand-hm'),
    att('brand-polo', 200, 80, 'brand-polo'),
    att('brand-levi',  200, 80, 'brand-levi'),
    att('brand-nike', 200, 80, 'brand-nike'),
    att('brand-adidas',200,80, 'brand-adidas'),
  ]);
  const [bZara, bHM, bRalph, bLevis, bNike, bAdidas] = await Brand.insertMany([
    { name: 'Zara',            slug: 'zara',    status: 1, brand_logo_id: brandImgs[0]._id },
    { name: 'H&M',             slug: 'hm',      status: 1, brand_logo_id: brandImgs[1]._id },
    { name: 'Ralph Lauren',    slug: 'ralph-lauren', status: 1, brand_logo_id: brandImgs[2]._id },
    { name: "Levi's",          slug: 'levis',   status: 1, brand_logo_id: brandImgs[3]._id },
    { name: 'Nike',            slug: 'nike',    status: 1, brand_logo_id: brandImgs[4]._id },
    { name: 'Adidas',          slug: 'adidas',  status: 1, brand_logo_id: brandImgs[5]._id },
  ]);
  const brands = [bZara, bHM, bRalph, bLevis, bNike, bAdidas];
  console.log('Marcas creadas');

  // ── 10. Atributos ────────────────────────────────────────────────────────────
  const attrColor = await Attribute.create({
    name: 'Color', slug: 'color', status: 1,
    attribute_values: [
      { value: 'Negro',       slug: 'negro',        hex_color: '#1a1a1a' },
      { value: 'Blanco',      slug: 'blanco',       hex_color: '#ffffff' },
      { value: 'Azul Marino', slug: 'azul-marino',  hex_color: '#1e3a5f' },
      { value: 'Gris',        slug: 'gris',         hex_color: '#9e9e9e' },
      { value: 'Beige',       slug: 'beige',        hex_color: '#f5f0e8' },
      { value: 'Camel',       slug: 'camel',        hex_color: '#c19a6b' },
      { value: 'Rosado',      slug: 'rosado',       hex_color: '#f4a7b9' },
      { value: 'Verde Salvia',slug: 'verde-salvia',  hex_color: '#b2bfae' },
      { value: 'Vinotinto',   slug: 'vinotinto',    hex_color: '#6d1f2a' },
      { value: 'Terracota',   slug: 'terracota',    hex_color: '#c0603b' },
      { value: 'Caqui',       slug: 'caqui',        hex_color: '#bfaf8e' },
      { value: 'Verde Oliva', slug: 'verde-oliva',  hex_color: '#6b6b3a' },
      { value: 'Rojo',        slug: 'rojo',         hex_color: '#c0392b' },
      { value: 'Azul Denim',  slug: 'azul-denim',   hex_color: '#5b7fa6' },
    ],
  });
  const attrSize = await Attribute.create({
    name: 'Talla', slug: 'talla', status: 1,
    attribute_values: [
      { value: 'XS',  slug: 'xs'  },
      { value: 'S',   slug: 's'   },
      { value: 'M',   slug: 'm'   },
      { value: 'L',   slug: 'l'   },
      { value: 'XL',  slug: 'xl'  },
      { value: 'XXL', slug: 'xxl' },
    ],
  });
  const C = v => attrColor.attribute_values.find(a => a.value === v);
  const S = v => attrSize.attribute_values.find(a => a.value === v);
  const mkAV = (attr, av) => ({ id: av._id, attribute_id: attr._id, value: av.value, slug: av.slug, hex_color: av.hex_color || null });

  function sizeVars(sizes, basePrice, salePx, baseQty, skuPrefix) {
    return sizes.map(sz => variation(sz, [mkAV(attrSize, S(sz))], basePrice, salePx, baseQty, `${skuPrefix}-${sz}`));
  }
  function colorSizeVars(colors, sizes, basePrice, salePx, skuPrefix) {
    const vars = [];
    colors.forEach(col => sizes.forEach(sz => {
      vars.push(variation(`${sz} / ${col}`, [mkAV(attrSize, S(sz)), mkAV(attrColor, C(col))], basePrice, salePx, 8, `${skuPrefix}-${sz.toLowerCase()}-${sl(col)}`));
    }));
    return vars;
  }

  console.log('Atributos creados');

  // ── 11. Productos ────────────────────────────────────────────────────────────
  async function productImgs(seed) {
    const thumb = await att(seed, 600, 750, `${seed}-thumb`);
    const gallery = await Promise.all([
      att(`${seed}-2`, 600, 750, `${seed}-g1`),
      att(`${seed}-3`, 600, 750, `${seed}-g2`),
      att(`${seed}-4`, 600, 750, `${seed}-g3`),
    ]);
    return { thumb, gallery };
  }

  const products = [];
  const base = { is_return: true, is_cod: true, safe_checkout: true, social_share: true, status: 1, stock_status: 'in_stock', unit: 'pieza', estimated_delivery_text: '3–5 días hábiles', return_policy_text: 'Devoluciones en 30 días con etiqueta original.', tax_id: iva._id, created_by_id: adminUser._id };

  // ─── VESTIDOS ──────────────────────────────────────────────────────────────

  { const imgs = await productImgs('women-dress-floral');
    products.push(await Product.create({ ...base,
      name: 'Vestido Midi Floral Cruzado', slug: 'vestido-midi-floral-cruzado',
      price: 189900, sale_price: 149900, discount: 21, quantity: 60, sku: 'VES-001',
      categories: [cDresses._id, cWomen._id, cSale._id], brand_id: bZara._id,
      is_featured: true, is_sale_enable: true, tags: ['Verano', 'Más Vendido'],
      description: '<p>Elegante vestido midi cruzado con estampado floral en viscosa 100%. El escote en V y la cintura ajustable con lazo crean una silueta favorecedora para todo tipo de cuerpo. Ideal para eventos al aire libre, brunch o la oficina.</p><ul><li>100% viscosa — liviano y transpirable</li><li>Largo midi (hasta la pantorrilla)</li><li>Cintura cruzada y ajustable</li><li>Talla exacta</li><li>Lavado en seco recomendado</li></ul>',
      short_description: 'Vestido midi cruzado con estampado floral en viscosa 100%. Para toda ocasión.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Negro', 'Rosado', 'Verde Salvia'], ['XS', 'S', 'M', 'L', 'XL'], 189900, 149900, 'VES-001'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  { const imgs = await productImgs('women-dress-satin');
    products.push(await Product.create({ ...base,
      name: 'Vestido Slip de Satén', slug: 'vestido-slip-de-saten',
      price: 249900, sale_price: null, discount: null, quantity: 40, sku: 'VES-002',
      categories: [cDresses._id, cWomen._id], brand_id: bZara._id,
      is_trending: true, tags: ['Nueva Colección'],
      description: '<p>Vestido slip de satén con corte al bies que cae de manera elegante sobre el cuerpo. Los tirantes ajustables garantizan un ajuste perfecto para cada silueta.</p><ul><li>100% poliéster satinado</li><li>Corte al bies para un drapeado fluido</li><li>Tirantes finos ajustables</li><li>Lavado a mano en agua fría</li></ul>',
      short_description: 'Vestido slip satinado con corte al bies y tirantes ajustables.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Negro', 'Beige', 'Vinotinto'], ['XS', 'S', 'M', 'L'], 249900, null, 'VES-002'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  { const imgs = await productImgs('women-dress-mini');
    products.push(await Product.create({ ...base,
      name: 'Vestido Mini Bodycon Acanalado', slug: 'vestido-mini-bodycon-acanalado',
      price: 115900, sale_price: 89900, discount: 22, quantity: 50, sku: 'VES-003',
      categories: [cDresses._id, cWomen._id, cSale._id], brand_id: bHM._id,
      is_featured: true, tags: ['Más Vendido', 'Verano'],
      description: '<p>Vestido mini bodycon de punto acanalado con mezcla elástica. El cuello redondo y las mangas cortas lo hacen versátil para noches de salida o para usar con accesorios de día.</p><ul><li>92% poliéster, 8% elastano</li><li>Tela acanalada elástica</li><li>Cuello redondo, manga corta</li><li>Largo mini</li><li>Lavado a máquina</li></ul>',
      short_description: 'Vestido mini bodycon acanalado y elástico. Del día a la noche.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Negro', 'Azul Marino', 'Rojo', 'Verde Salvia'], ['XS', 'S', 'M', 'L', 'XL'], 115900, 89900, 'VES-003'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  // ─── BLUSAS Y TOPS ─────────────────────────────────────────────────────────

  { const imgs = await productImgs('women-blouse-linen');
    products.push(await Product.create({ ...base,
      name: 'Blusa de Lino Escote en V', slug: 'blusa-de-lino-escote-en-v',
      price: 105900, sale_price: null, discount: null, quantity: 70, sku: 'BLS-001',
      categories: [cTops._id, cWomen._id], brand_id: bHM._id,
      tags: ['Verano', 'Sostenible'],
      description: '<p>Blusa de lino con escote en V fabricada con lino europeo de origen sostenible. Corte relajado con opción de doblar las mangas para un look casual de fin de semana.</p><ul><li>100% lino europeo</li><li>Corte relajado ligeramente oversize</li><li>Escote en V con detalle de botones</li><li>Disponible en 5 tonos neutros</li><li>Lavado a máquina en ciclo suave</li></ul>',
      short_description: 'Blusa de lino 100% con escote en V. Origen sostenible.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Blanco', 'Beige', 'Verde Salvia', 'Rosado', 'Negro'], ['XS', 'S', 'M', 'L', 'XL'], 105900, null, 'BLS-001'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  { const imgs = await productImgs('women-sweater-knit');
    products.push(await Product.create({ ...base,
      name: 'Suéter de Punto Oversize', slug: 'sueter-de-punto-oversize',
      price: 169900, sale_price: 129900, discount: 24, quantity: 55, sku: 'BLS-002',
      categories: [cTops._id, cWomen._id, cSale._id], brand_id: bRalph._id,
      is_featured: true, tags: ['Más Vendido'],
      description: '<p>Suéter de punto oversize increíblemente acogedor con silueta de hombros caídos. Confeccionado en mezcla de lana suave, combina perfecto con jeans o como vestido corto.</p><ul><li>60% lana, 40% acrílico</li><li>Corte oversize con hombros caídos</li><li>Puños y dobladillo en punto canalé</li><li>Cuello redondo</li><li>Solo lavado en seco</li></ul>',
      short_description: 'Acogedor suéter oversize de mezcla de lana. Combina con todo.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Camel', 'Gris', 'Blanco', 'Vinotinto', 'Verde Oliva'], ['XS', 'S', 'M', 'L', 'XL'], 169900, 129900, 'BLS-002'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  // ─── PANTALONES MUJER ──────────────────────────────────────────────────────

  { const imgs = await productImgs('women-jeans-skinny');
    products.push(await Product.create({ ...base,
      name: 'Jeans Skinny Tiro Alto', slug: 'jeans-skinny-tiro-alto',
      price: 189900, sale_price: 149900, discount: 21, quantity: 80, sku: 'PAN-001',
      categories: [cPantsW._id, cWomen._id, cSale._id], brand_id: bLevis._id,
      is_featured: true, is_trending: true, tags: ['Más Vendido'],
      description: '<p>El icónico jean skinny de tiro alto, actualizado para 2026. Confeccionado en denim premium elástico que moldea y contornea manteniendo comodidad todo el día.</p><ul><li>98% algodón, 2% elastano</li><li>Tiro alto (26 cm)</li><li>Pierna skinny</li><li>5 bolsillos</li><li>Disponible en 3 lavados</li><li>Lavado a máquina</li></ul>',
      short_description: 'Jeans skinny tiro alto en denim elástico premium. Comodidad todo el día.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Negro', 'Azul Denim', 'Blanco'], ['XS', 'S', 'M', 'L', 'XL'], 189900, 149900, 'PAN-001'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  { const imgs = await productImgs('women-skirt-pleated');
    products.push(await Product.create({ ...base,
      name: 'Falda Midi Plisada de Satén', slug: 'falda-midi-plisada-de-saten',
      price: 139900, sale_price: null, discount: null, quantity: 45, sku: 'FAL-001',
      categories: [cSkirts._id, cWomen._id], brand_id: bZara._id,
      is_trending: true, tags: ['Nueva Colección'],
      description: '<p>Elegante falda midi plisada de satén con una silueta fluida que se mueve de forma hermosa. La cintura elástica garantiza comodidad y el largo midi ofrece la proporción perfecta.</p><ul><li>100% poliéster satinado</li><li>Pliegues cuchillo por toda la prenda</li><li>Cintura elástica</li><li>Largo midi (aprox. 85 cm)</li><li>Lavado en seco recomendado</li></ul>',
      short_description: 'Elegante falda midi plisada de satén. Silueta fluida, cintura elástica.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Negro', 'Beige', 'Vinotinto', 'Terracota'], ['XS', 'S', 'M', 'L'], 139900, null, 'FAL-001'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  // ─── ABRIGOS MUJER ─────────────────────────────────────────────────────────

  { const imgs = await productImgs('women-trench-coat');
    products.push(await Product.create({ ...base,
      name: 'Gabardina Clásica', slug: 'gabardina-clasica',
      price: 529900, sale_price: 399900, discount: 25, quantity: 30, sku: 'ABR-001',
      categories: [cOuterW._id, cWomen._id, cSale._id], brand_id: bRalph._id,
      is_featured: true, tags: ['Más Vendido', 'Edición Limitada'],
      description: '<p>La gabardina clásica por excelencia, confeccionada en gabardina de algodón resistente al agua. Doble botonadura, solapa de tormenta y trabilla de pistola son fieles al diseño original con silueta contemporánea.</p><ul><li>100% gabardina de algodón impermeable</li><li>Doble botonadura</li><li>Cinturón en la cintura</li><li>Forro de lana desmontable</li><li>Solo lavado en seco</li></ul>',
      short_description: 'Gabardina de algodón resistente al agua con forro desmontable.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Camel', 'Negro', 'Beige'], ['XS', 'S', 'M', 'L', 'XL'], 529900, 399900, 'ABR-001'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  { const imgs = await productImgs('women-jacket-leather');
    products.push(await Product.create({ ...base,
      name: 'Chaqueta Biker de Ecocuero', slug: 'chaqueta-biker-de-ecocuero',
      price: 319900, sale_price: 249900, discount: 22, quantity: 35, sku: 'ABR-002',
      categories: [cOuterW._id, cWomen._id, cSale._id], brand_id: bHM._id,
      is_trending: true, tags: ['Más Vendido'],
      description: '<p>Chaqueta biker de ecocuero premium con corte slim moderno. Cierres metálicos, hombros acolchados y dobladillo con cinturón ajustable le dan un auténtico toque urbano sin compromiso ético.</p><ul><li>Ecocuero vegano premium</li><li>Cierre asimétrico</li><li>Hombros acolchados</li><li>Múltiples bolsillos con cremallera</li><li>Dobladillo con cinturón ajustable</li></ul>',
      short_description: 'Chaqueta biker de ecocuero vegano con cierres metálicos.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Negro', 'Camel', 'Vinotinto'], ['XS', 'S', 'M', 'L', 'XL'], 319900, 249900, 'ABR-002'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  // ─── DEPORTIVO MUJER ───────────────────────────────────────────────────────

  { const imgs = await productImgs('women-activewear-set');
    products.push(await Product.create({ ...base,
      name: 'Set Deportivo Sin Costuras', slug: 'set-deportivo-sin-costuras',
      price: 179900, sale_price: 139900, discount: 22, quantity: 60, sku: 'DEP-001',
      unit: 'conjunto',
      categories: [cActiveW._id, cWomen._id, cSale._id], brand_id: bAdidas._id,
      is_featured: true, is_trending: true, tags: ['Más Vendido', 'Nueva Colección'],
      description: '<p>Set deportivo sin costuras de alto rendimiento diseñado para yoga, pilates y entrenamientos cotidianos. La construcción sin costuras elimina la fricción y el top deportivo ofrece soporte medio.</p><ul><li>88% nylon, 12% spandex</li><li>Sin costuras — sin rozaduras</li><li>Leggings de tiro alto con bolsillos laterales</li><li>Top deportivo con copa desmontable</li><li>4 vías de estiramiento, absorbe la humedad</li><li>Lavado a máquina</li></ul>',
      short_description: 'Set deportivo sin costuras de alto rendimiento. Estiramiento en 4 direcciones.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Negro', 'Gris', 'Azul Marino', 'Rosado', 'Verde Salvia'], ['XS', 'S', 'M', 'L', 'XL'], 179900, 139900, 'DEP-001'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  // ─── CAMISETAS HOMBRE ──────────────────────────────────────────────────────

  { const imgs = await productImgs('men-tshirt-essential');
    products.push(await Product.create({ ...base,
      name: 'Camiseta Básica Cuello Redondo', slug: 'camiseta-basica-cuello-redondo',
      price: 62900, sale_price: null, discount: null, quantity: 150, sku: 'CAM-001',
      categories: [cTshirts._id, cMen._id], brand_id: bHM._id,
      is_featured: true, tags: ['Más Vendido'],
      description: '<p>La camiseta esencial perfecta — confeccionada en algodón orgánico 200gsm para una sensación premium que mejora con cada lavado. Pre-encogida y con costura lateral para un ajuste consistente.</p><ul><li>200gsm 100% algodón orgánico</li><li>Pre-encogida y costura lateral</li><li>Cuello redondo con ribete acanalado</li><li>Corte regular relajado</li><li>Lavado a máquina</li></ul>',
      short_description: 'Camiseta de algodón orgánico 200gsm. El esencial cotidiano.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Negro', 'Blanco', 'Azul Marino', 'Gris', 'Verde Oliva', 'Vinotinto'], ['S', 'M', 'L', 'XL', 'XXL'], 62900, null, 'CAM-001'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  { const imgs = await productImgs('men-tshirt-graphic');
    products.push(await Product.create({ ...base,
      name: 'Camiseta Oversize Estampada', slug: 'camiseta-oversize-estampada',
      price: 84900, sale_price: 64900, discount: 24, quantity: 80, sku: 'CAM-002',
      categories: [cTshirts._id, cMen._id, cSale._id], brand_id: bHM._id,
      is_trending: true, tags: ['Nueva Colección'],
      description: '<p>Camiseta oversize con arte gráfico exclusivo estampado en algodón de alta gramaje. El corte boxy y los hombros caídos dan una silueta moderna y urbana.</p><ul><li>100% algodón pesado (220gsm)</li><li>Corte oversize, boxy fit</li><li>Estampado en serigrafía exclusivo</li><li>Construcción de hombros caídos</li><li>Lavado a máquina (voltear antes de lavar)</li></ul>',
      short_description: 'Camiseta oversize de algodón pesado con estampado exclusivo en serigrafía.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Negro', 'Blanco', 'Gris'], ['S', 'M', 'L', 'XL', 'XXL'], 84900, 64900, 'CAM-002'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  // ─── CAMISAS HOMBRE ────────────────────────────────────────────────────────

  { const imgs = await productImgs('men-shirt-oxford');
    products.push(await Product.create({ ...base,
      name: 'Camisa Oxford con Botones', slug: 'camisa-oxford-con-botones',
      price: 149900, sale_price: null, discount: null, quantity: 60, sku: 'CMI-001',
      categories: [cShirts._id, cMen._id], brand_id: bRalph._id,
      is_featured: true, tags: ['Más Vendido'],
      description: '<p>La camisa Oxford definitiva — confeccionada en algodón de tejido Oxford auténtico con cuello con botones. Versátil para viernes casuales o cenas semiformal, es imprescindible en todo guardarropa.</p><ul><li>100% algodón tejido Oxford</li><li>Cuello con botones</li><li>Bolsillo de pecho simple</li><li>Corte regular — entallado en el pecho</li><li>Lavado a máquina</li></ul>',
      short_description: 'Camisa Oxford de algodón con cuello de botones. Smart casual definitiva.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Blanco', 'Azul Marino', 'Rosado', 'Gris'], ['S', 'M', 'L', 'XL', 'XXL'], 149900, null, 'CMI-001'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  // ─── PANTALONES HOMBRE ─────────────────────────────────────────────────────

  { const imgs = await productImgs('men-chinos-slim');
    products.push(await Product.create({ ...base,
      name: 'Pantalón Chino Slim Elástico', slug: 'pantalon-chino-slim-elastico',
      price: 189900, sale_price: 149900, discount: 21, quantity: 70, sku: 'PNH-001',
      categories: [cPantsM._id, cMen._id, cSale._id], brand_id: bZara._id,
      is_featured: true, tags: ['Más Vendido'],
      description: '<p>Chinos slim fit premium en sarga elástica de algodón para una silueta definida sin sacrificar movimiento. El diseño limpio combina igual con tenis o zapatos de vestir.</p><ul><li>97% algodón, 3% elastano</li><li>Corte slim a través del muslo y rodilla</li><li>Tiro medio</li><li>5 bolsillos</li><li>Lavado a máquina</li></ul>',
      short_description: 'Chino slim fit en sarga elástica. Smart casual perfecto.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Azul Marino', 'Caqui', 'Verde Oliva', 'Negro', 'Beige'], ['S', 'M', 'L', 'XL', 'XXL'], 189900, 149900, 'PNH-001'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  { const imgs = await productImgs('men-jeans-dark');
    products.push(await Product.create({ ...base,
      name: 'Jeans Rectos Lavado Oscuro', slug: 'jeans-rectos-lavado-oscuro',
      price: 229900, sale_price: null, discount: null, quantity: 65, sku: 'PNH-002',
      categories: [cPantsM._id, cMen._id], brand_id: bLevis._id,
      is_trending: true, tags: ['Más Vendido'],
      description: '<p>El jean de pierna recta en lavado índigo oscuro. Confeccionado en denim selvedge japonés premium que se suaviza con el uso y desarrolla una pátina única con el tiempo.</p><ul><li>100% denim selvedge japonés</li><li>Pierna recta clásica</li><li>Lavado índigo oscuro</li><li>5 bolsillos con parche de cuero</li><li>Lavado a máquina — voltear en agua fría</li></ul>',
      short_description: 'Jeans de pierna recta en denim selvedge japonés. Índigo oscuro.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Azul Denim', 'Negro'], ['S', 'M', 'L', 'XL', 'XXL'], 229900, null, 'PNH-002'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  // ─── ABRIGOS HOMBRE ────────────────────────────────────────────────────────

  { const imgs = await productImgs('men-blazer-wool');
    products.push(await Product.create({ ...base,
      name: 'Blazer de Lana Sastre', slug: 'blazer-de-lana-sastre',
      price: 629900, sale_price: 479900, discount: 24, quantity: 25, sku: 'BLZ-001',
      categories: [cOuterM._id, cMen._id, cSale._id], brand_id: bRalph._id,
      is_featured: true, tags: ['Edición Limitada', 'Más Vendido'],
      description: '<p>Blazer de un botón majestuosamente entallado en tela de mezcla de lana italiana. Los hombros estructurados y las solapas limpias crean una silueta definida para reuniones, eventos o looks casuales elevados.</p><ul><li>70% lana, 30% poliéster tela italiana</li><li>Cierre de dos botones simple</li><li>Solapas de muesca</li><li>Hombros rellenos estructurados</li><li>Construcción media entretela</li><li>Solo lavado en seco</li></ul>',
      short_description: 'Blazer sastre en mezcla de lana italiana. Media entretela.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Azul Marino', 'Gris', 'Caqui', 'Negro'], ['S', 'M', 'L', 'XL'], 629900, 479900, 'BLZ-001'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  { const imgs = await productImgs('men-bomber-jacket');
    products.push(await Product.create({ ...base,
      name: 'Chaqueta Bomber Varsity', slug: 'chaqueta-bomber-varsity',
      price: 339900, sale_price: 269900, discount: 21, quantity: 40, sku: 'ABH-001',
      categories: [cOuterM._id, cMen._id, cSale._id], brand_id: bAdidas._id,
      is_trending: true, tags: ['Nueva Colección'],
      description: '<p>Interpretación moderna del clásico bomber varsity con exterior de satén brillante y ribetes de punto acogedores. La silueta boxy y los colores discretos lo hacen versátil para el día a día.</p><ul><li>100% poliéster satinado exterior</li><li>Ribetes de punto en cuello, puños y dobladillo</li><li>Bolsillo interior con cremallera + 2 bolsillos laterales</li><li>Corte boxy relajado</li><li>Lavado a máquina</li></ul>',
      short_description: 'Bomber varsity moderno en satén con ribetes de punto. Corte relajado.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Negro', 'Azul Marino', 'Verde Oliva', 'Vinotinto'], ['S', 'M', 'L', 'XL', 'XXL'], 339900, 269900, 'ABH-001'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  // ─── ACCESORIOS ────────────────────────────────────────────────────────────

  { const imgs = await productImgs('bag-leather-tote');
    products.push(await Product.create({ ...base,
      name: 'Tote de Cuero Estructurado', slug: 'tote-de-cuero-estructurado',
      price: 399900, sale_price: 319900, discount: 20, quantity: 30, sku: 'BOL-001',
      categories: [cBags._id, cAcc._id, cSale._id], brand_id: bZara._id,
      is_featured: true, tags: ['Más Vendido', 'Edición Limitada'],
      description: '<p>Elegante tote estructurado confeccionado en cuero granulado de grano completo. Espacioso para un portátil de 13" con bolsillos interiores organizados. La herraje dorado le agrega un toque lujoso.</p><ul><li>Cuero granulado de grano completo</li><li>Herraje en tono dorado</li><li>Bolsillo interior con cremallera + 2 deslizantes</li><li>Cabe portátil de 13"</li><li>Correa cruzada desmontable incluida</li><li>Dimensiones: 38 x 30 x 14 cm</li></ul>',
      short_description: 'Tote de cuero de grano completo con correa cruzada desmontable.',
      attributes_ids: [attrColor._id],
      variations: [
        variation('Negro',    [mkAV(attrColor, C('Negro'))],    399900, 319900, 10, 'BOL-001-NGR'),
        variation('Camel',    [mkAV(attrColor, C('Camel'))],    399900, 319900, 10, 'BOL-001-CAM'),
        variation('Vinotinto',[mkAV(attrColor, C('Vinotinto'))],399900, 319900, 10, 'BOL-001-VNT'),
      ],
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  { const imgs = await productImgs('bag-canvas-backpack');
    products.push(await Product.create({ ...base,
      name: 'Mochila de Lona Encerada', slug: 'mochila-de-lona-encerada',
      price: 249900, sale_price: null, discount: null, quantity: 45, sku: 'BOL-002',
      categories: [cBags._id, cAcc._id], brand_id: bHM._id,
      is_trending: true, tags: ['Nueva Colección', 'Sostenible'],
      description: '<p>Mochila de lona encerada de estilo heritage construida para durar. El acabado ceroso repele el agua y desarrolla una pátina hermosa con el tiempo. Incluye porta-portátil acolchado y panel ergonómico trasero.</p><ul><li>Lona de algodón encerado</li><li>Tratamiento resistente al agua</li><li>Porta-portátil acolchado de 15"</li><li>Panel trasero ergonómico acolchado</li><li>Herraje de latón envejecido</li><li>Capacidad: 25L</li></ul>',
      short_description: 'Mochila de lona encerada 25L con porta-portátil de 15". Resistente al agua.',
      attributes_ids: [attrColor._id],
      variations: [
        variation('Negro',       [mkAV(attrColor, C('Negro'))],      249900, null, 15, 'BOL-002-NGR'),
        variation('Caqui',       [mkAV(attrColor, C('Caqui'))],      249900, null, 15, 'BOL-002-KHK'),
        variation('Verde Oliva', [mkAV(attrColor, C('Verde Oliva'))],249900, null, 15, 'BOL-002-OLV'),
        variation('Azul Marino', [mkAV(attrColor, C('Azul Marino'))],249900, null, 15, 'BOL-002-NVY'),
      ],
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  { const imgs = await productImgs('jewelry-hoops-gold');
    products.push(await Product.create({ ...base,
      name: 'Aretes Argollas Doradas Gruesas', slug: 'aretes-argollas-doradas-gruesas',
      price: 94900, sale_price: null, discount: null, quantity: 80, unit: 'par', sku: 'JOY-001',
      categories: [cJewelry._id, cAcc._id], brand_id: null,
      is_trending: true, tags: ['Más Vendido', 'Nueva Colección'],
      description: '<p>Llamativos aretes argollas gruesas bañadas en oro de 18k. El toque final perfecto para cualquier look, desde jeans y camiseta hasta un vestido de noche.</p><ul><li>Base de latón con baño de oro 18k</li><li>Cierre hipoalergénico de mariposa</li><li>Diámetro: 4 cm</li><li>Grosor del tubo: 4 mm</li><li>Se venden en par</li></ul>',
      short_description: 'Aretes argollas bañadas en oro 18k. Hipoalergénicas. 4 cm de diámetro.',
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  { const imgs = await productImgs('accessories-scarf');
    products.push(await Product.create({ ...base,
      name: 'Bufanda Mezcla de Cachemira', slug: 'bufanda-mezcla-de-cachemira',
      price: 189900, sale_price: 149900, discount: 21, quantity: 50, sku: 'ACC-001',
      categories: [cAcc._id], brand_id: bRalph._id,
      is_featured: true, tags: ['Más Vendido'],
      description: '<p>Increíblemente suave bufanda de mezcla de cachemira con generoso tamaño para múltiples formas de uso: drapeada, envuelta o anudada. El sutil tejido de espiga añade textura sin restarle protagonismo.</p><ul><li>80% cachemira, 20% lana</li><li>Medidas: 180 x 70 cm</li><li>Tejido de espiga</li><li>Flecos en los extremos</li><li>Solo lavado en seco</li></ul>',
      short_description: 'Bufanda 80% cachemira en tejido de espiga. 180 x 70 cm.',
      attributes_ids: [attrColor._id],
      variations: [
        variation('Camel',    [mkAV(attrColor, C('Camel'))],    189900, 149900, 12, 'ACC-001-CAM'),
        variation('Gris',     [mkAV(attrColor, C('Gris'))],     189900, 149900, 12, 'ACC-001-GRS'),
        variation('Vinotinto',[mkAV(attrColor, C('Vinotinto'))],189900, 149900, 12, 'ACC-001-VNT'),
        variation('Azul Marino',[mkAV(attrColor, C('Azul Marino'))],189900, 149900, 12, 'ACC-001-NVY'),
      ],
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  { const imgs = await productImgs('accessories-cap');
    products.push(await Product.create({ ...base,
      name: 'Gorra Béisbol Clásica 6 Paneles', slug: 'gorra-beisbol-clasica-6-paneles',
      price: 72900, sale_price: null, discount: null, quantity: 90, sku: 'SOM-001',
      categories: [cHats._id, cAcc._id], brand_id: bNike._id,
      is_trending: true, tags: ['Más Vendido', 'Nueva Colección'],
      description: '<p>Gorra de béisbol estructurada de 6 paneles en mezcla de lana premium. La correa trasera ajustable garantiza el ajuste perfecto para todo tipo de cabeza.</p><ul><li>60% lana, 40% poliéster</li><li>Diseño estructurado de 6 paneles</li><li>Visera pre-curvada</li><li>Ojales bordados</li><li>Correa de cierre ajustable</li></ul>',
      short_description: 'Gorra de béisbol estructurada en mezcla de lana. Correa ajustable.',
      attributes_ids: [attrColor._id],
      variations: [
        variation('Negro',      [mkAV(attrColor, C('Negro'))],     72900, null, 20, 'SOM-001-NGR'),
        variation('Blanco',     [mkAV(attrColor, C('Blanco'))],    72900, null, 20, 'SOM-001-BLC'),
        variation('Azul Marino',[mkAV(attrColor, C('Azul Marino'))],72900,null, 20, 'SOM-001-NVY'),
        variation('Beige',      [mkAV(attrColor, C('Beige'))],     72900, null, 20, 'SOM-001-BGE'),
        variation('Verde Oliva',[mkAV(attrColor, C('Verde Oliva'))],72900,null, 10, 'SOM-001-OLV'),
      ],
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  // ─── CALZADO ───────────────────────────────────────────────────────────────

  { const imgs = await productImgs('shoes-women-platform');
    products.push(await Product.create({ ...base,
      name: 'Zapatillas Plataforma de Cuero Blanco', slug: 'zapatillas-plataforma-cuero-blanco',
      price: 269900, sale_price: 209900, discount: 22, quantity: 45, unit: 'par', sku: 'CAL-001',
      categories: [cShoesW._id, cShoes._id, cSale._id], brand_id: bAdidas._id,
      is_featured: true, is_trending: true, tags: ['Más Vendido', 'Nueva Colección'],
      description: '<p>Zapatillas icónicas de cuero blanco con plataforma gruesa de 4 cm que añade estatura sin esfuerzo. La parte superior en cuero perforado y la franja lateral son una pieza de inversión atemporal.</p><ul><li>Cuero de grano completo</li><li>Plataforma de caucho de 4 cm</li><li>Plantilla de cuero acolchada</li><li>Cierre de cordones</li><li>Tallas EU 36–41</li></ul>',
      short_description: 'Zapatillas de cuero de grano completo con plataforma 4 cm. EU 36–41.',
      attributes_ids: [attrSize._id],
      variations: sizeVars(['S', 'M', 'L', 'XL'], 269900, 209900, 8, 'CAL-001'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  { const imgs = await productImgs('shoes-women-heels');
    products.push(await Product.create({ ...base,
      name: 'Sandalias Taco Bloque Puntera Cuadrada', slug: 'sandalias-taco-bloque-puntera-cuadrada',
      price: 209900, sale_price: null, discount: null, quantity: 35, unit: 'par', sku: 'CAL-002',
      categories: [cShoesW._id, cShoes._id], brand_id: bZara._id,
      is_trending: true, tags: ['Nueva Colección'],
      description: '<p>Sandalias de taco bloque con puntera cuadrada que captura perfectamente la estética minimalista contemporánea. El taco de 7 cm aporta estabilidad sin sacrificar elegancia.</p><ul><li>Parte superior y forro de cuero</li><li>Puntera cuadrada, silueta sin talón</li><li>Taco bloque de 7 cm</li><li>Taco forrado en cuero</li><li>Tallas EU 35–41</li></ul>',
      short_description: 'Sandalias taco bloque de cuero. Taco estable 7 cm. EU 35–41.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Negro', 'Beige', 'Camel'], ['XS', 'S', 'M', 'L'], 209900, null, 'CAL-002'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  { const imgs = await productImgs('shoes-men-chelsea');
    products.push(await Product.create({ ...base,
      name: 'Botines Chelsea de Cuero', slug: 'botines-chelsea-de-cuero',
      price: 419900, sale_price: 329900, discount: 21, quantity: 30, unit: 'par', sku: 'CLH-001',
      categories: [cShoesM._id, cShoes._id, cSale._id], brand_id: bRalph._id,
      is_featured: true, tags: ['Más Vendido'],
      description: '<p>Botines Chelsea atemporales en cuero de becerro con elásticos laterales para fácil calzado. La parte superior desarrolla una rica pátina con la edad y la suela cosida Goodyear garantiza décadas de uso.</p><ul><li>Cuero de becerro de grano completo</li><li>Construcción cosida Goodyear</li><li>Elásticos laterales</li><li>Trabilla trasera</li><li>Suela de cuero con tapa de caucho</li><li>Tallas EU 40–46</li></ul>',
      short_description: 'Botines Chelsea en cuero de grano completo cosidos Goodyear. EU 40–46.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Negro', 'Camel'], ['S', 'M', 'L', 'XL'], 419900, 329900, 'CLH-001'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  { const imgs = await productImgs('shoes-men-running');
    products.push(await Product.create({ ...base,
      name: 'Zapatillas Running Alto Rendimiento', slug: 'zapatillas-running-alto-rendimiento',
      price: 379900, sale_price: 299900, discount: 21, quantity: 50, unit: 'par', sku: 'RUN-001',
      categories: [cShoesM._id, cShoes._id, cSale._id], brand_id: bAdidas._id,
      is_featured: true, is_trending: true, tags: ['Más Vendido', 'Nueva Colección'],
      description: '<p>Zapatillas de running de alto rendimiento con retorno de energía. La parte superior de tejido reciclado ofrece estructura transpirable y la mediasuela boost retorna 60% de energía en cada zancada.</p><ul><li>Upper Primeknit+ de plástico oceánico reciclado</li><li>Mediasuela Boost con retorno de energía</li><li>Suela Continental™ de caucho</li><li>Sistema de torsión para soporte medio-pie</li><li>Tallas EU 39–46</li></ul>',
      short_description: 'Zapatillas running con retorno de energía y upper de plástico reciclado. EU 39–46.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Negro', 'Blanco', 'Gris', 'Azul Marino'], ['S', 'M', 'L', 'XL'], 379900, 299900, 'RUN-001'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  // ─── DEPORTIVO HOMBRE ──────────────────────────────────────────────────────

  { const imgs = await productImgs('men-activewear-jogger');
    products.push(await Product.create({ ...base,
      name: 'Set Sudadera y Pantalón Jogger', slug: 'set-sudadera-y-pantalon-jogger',
      price: 229900, sale_price: 179900, discount: 22, quantity: 55, unit: 'conjunto', sku: 'DEH-001',
      categories: [cActiveM._id, cMen._id, cSale._id], brand_id: bNike._id,
      is_featured: true, is_trending: true, tags: ['Más Vendido', 'Nueva Colección'],
      description: '<p>Set de sudadera y jogger en tech fleece diseñado para máximo calor sin volumen. La construcción de doble capa atrapa el calor mientras el corte ergonómico permite rango completo de movimiento.</p><ul><li>Tech fleece: 56% algodón, 44% poliéster</li><li>Sudadera con cremallera y bolsillo canguro</li><li>Jogger cónico con cintura elástica y cordón</li><li>Bolsillos laterales profundos + bolsillo trasero con cremallera</li><li>Lavado a máquina</li></ul>',
      short_description: 'Set sudadera y jogger cónico en tech fleece. Calor máximo.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Negro', 'Gris', 'Azul Marino', 'Verde Oliva'], ['S', 'M', 'L', 'XL', 'XXL'], 229900, 179900, 'DEH-001'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  { const imgs = await productImgs('accessories-silk-scarf');
    products.push(await Product.create({ ...base,
      name: 'Pañoleta de Seda Estampado Vintage', slug: 'panoleta-seda-estampado-vintage',
      price: 124900, sale_price: null, discount: null, quantity: 40, sku: 'PAÑ-001',
      categories: [cAcc._id, cWomen._id], brand_id: bZara._id,
      is_trending: true, tags: ['Nueva Colección'],
      description: '<p>Lujosa pañoleta 100% seda twill con estampado vintage exclusivo. Úsala en el cabello, en el cuello, en la cartera o como top — las posibilidades son infinitas.</p><ul><li>100% seda twill</li><li>Formato cuadrado 90 x 90 cm</li><li>Dobladillo enrollado a mano</li><li>Estampado vintage exclusivo</li><li>Solo lavado en seco</li></ul>',
      short_description: 'Pañoleta 100% seda twill 90x90cm con dobladillo enrollado a mano. Estampado vintage exclusivo.',
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  { const imgs = await productImgs('women-trousers-palazzo');
    products.push(await Product.create({ ...base,
      name: 'Pantalón Palazzo Pierna Amplia', slug: 'pantalon-palazzo-pierna-amplia',
      price: 159900, sale_price: 124900, discount: 22, quantity: 50, sku: 'PAN-002',
      categories: [cPantsW._id, cWomen._id, cSale._id], brand_id: bZara._id,
      is_trending: true, tags: ['Nueva Colección', 'Verano'],
      description: '<p>Pantalón palazzo con corte de pierna amplia de gran elegancia. La tela fluida crea un movimiento hermoso y la cintura alta alarga la silueta.</p><ul><li>100% crepé de poliéster liviano</li><li>Silueta palazzo de tiro alto y pierna ancha</li><li>Cremallera lateral invisible</li><li>Bolsillos laterales</li><li>Lavado a máquina ciclo delicado</li></ul>',
      short_description: 'Pantalón palazzo fluido y de pierna ancha en crepé liviano. Tiro alto.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Negro', 'Beige', 'Verde Salvia', 'Terracota'], ['XS', 'S', 'M', 'L', 'XL'], 159900, 124900, 'PAN-002'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  { const imgs = await productImgs('men-sweater-merino');
    products.push(await Product.create({ ...base,
      name: 'Suéter Cuello Redondo de Lana Merino', slug: 'sueter-cuello-redondo-lana-merino',
      price: 289900, sale_price: 229900, discount: 21, quantity: 45, sku: 'SUT-001',
      categories: [cShirts._id, cMen._id, cSale._id], brand_id: bRalph._id,
      is_featured: true, tags: ['Más Vendido', 'Sostenible'],
      description: '<p>Suéter de lana merino de cuello redondo en lana ZQ certificada de granjas de Nueva Zelanda. La merino fina de 18.5 micrones regula la temperatura naturalmente, resiste olores y es lavable a máquina.</p><ul><li>100% lana merino ZQ (18.5 micrones)</li><li>Regulación natural de temperatura</li><li>Propiedades anti-olor</li><li>Cuello, puños y dobladillo canalé</li><li>Lavado a máquina en ciclo lana</li></ul>',
      short_description: 'Suéter de merino fino ZQ certificado. Lavable a máquina. Anti-olor.',
      attributes_ids: [attrSize._id, attrColor._id],
      variations: colorSizeVars(['Azul Marino', 'Gris', 'Camel', 'Vinotinto', 'Negro'], ['S', 'M', 'L', 'XL', 'XXL'], 289900, 229900, 'SUT-001'),
      product_thumbnail_id: imgs.thumb._id, product_images: imgs.gallery.map(g => g._id),
    }));
  }

  console.log(`Productos creados: ${products.length}`);

  // ── 12. Reseñas ──────────────────────────────────────────────────────────────
  await Review.insertMany([
    { product_id: products[0]._id,  consumer_id: consumerUser._id, rating: 5, description: '¡Vestido absolutamente hermoso! El estampado floral es vibrante y la tela increíblemente suave. Talla exacta y muy favorecedor. Lo usé en un evento al aire libre y recibí elogios toda la noche.' },
    { product_id: products[0]._id,  consumer_id: consumerUser._id, rating: 4, description: 'Vestido de gran calidad. El lazo ajustable es perfecto. Los colores son exactamente como los de la foto. Me quedó bien subiendo media talla.' },
    { product_id: products[1]._id,  consumer_id: consumerUser._id, rating: 5, description: 'El vestido slip de satén es pura elegancia. El corte al bies es muy favorecedor y la calidad del satén es premium, no se ve barato. Perfecto para ocasiones especiales.' },
    { product_id: products[4]._id,  consumer_id: consumerUser._id, rating: 5, description: '¡Es mi tercera compra de este suéter en distintos colores! Increíblemente suave, mantiene su forma perfectamente incluso después de muchos lavados. Vale cada peso.' },
    { product_id: products[5]._id,  consumer_id: consumerUser._id, rating: 5, description: 'Por fin encontré el jean skinny perfecto. El elástico es ideal — cómodo para moverse pero mantiene la forma todo el día. El tiro alto es muy favorecedor.' },
    { product_id: products[7]._id,  consumer_id: consumerUser._id, rating: 5, description: 'Quería una gabardina de calidad hace años y esta vale la inversión. La construcción es impecable y el forro desmontable me permite usarla todo el año.' },
    { product_id: products[9]._id,  consumer_id: consumerUser._id, rating: 5, description: 'El mejor set deportivo que he comprado. La construcción sin costuras elimina la fricción por completo. La tela es gruesa y no se transparenta al agacharse.' },
    { product_id: products[10]._id, consumer_id: consumerUser._id, rating: 5, description: 'Estas camisetas tienen un valor increíble por la calidad. Gruesas, pre-encogidas y el corte es consistente lavado tras lavado. Las compré en 5 colores.' },
    { product_id: products[12]._id, consumer_id: consumerUser._id, rating: 5, description: 'La mejor camisa Oxford que he tenido. La tela es firme pero no rígida y mejora con el lavado. El ajuste en el pecho es perfectamente entallado.' },
    { product_id: products[15]._id, consumer_id: consumerUser._id, rating: 5, description: 'Dudé en gastar tanto en un blazer pero ha transformado mi guardarropa. La construcción es claramente premium. Queda como una segunda piel.' },
    { product_id: products[17]._id, consumer_id: consumerUser._id, rating: 5, description: 'Este tote es la cartera de trabajo perfecta. Luce lujoso, cabe mi portátil fácilmente y la organización interior es excelente. El cuero ya está desarrollando una hermosa pátina.' },
    { product_id: products[22]._id, consumer_id: consumerUser._id, rating: 4, description: 'Zapatillas preciosas. La calidad del cuero es excelente y la plataforma da altura sin ser incómoda. Quedan un poco ajustadas — recomiendo subir medio número si tienes pie ancho.' },
    { product_id: products[24]._id, consumer_id: consumerUser._id, rating: 5, description: 'Los botines Chelsea valen totalmente el precio premium. La costura Goodyear significa que se pueden resuelas — estos durarán 20+ años. La calidad del cuero es excepcional.' },
    { product_id: products[25]._id, consumer_id: consumerUser._id, rating: 5, description: 'Las zapatillas de running más rápidas que he usado. El retorno de energía del boost es notorio inmediatamente. Los materiales reciclados son un plus enorme. Talla exacta.' },
    { product_id: products[26]._id, consumer_id: consumerUser._id, rating: 5, description: 'Este set es tan cómodo que lo uso como ropa de casa y también para entrenar. El tech fleece es grueso y cálido sin ser sofocante. El jogger cónico luce mucho más arreglado.' },
  ]);
  console.log('Reseñas creadas');

  // ── 13. Carrito, Pedidos, Listas de Deseos ───────────────────────────────────
  const direccionBogota = {
    title: 'Casa', street: 'Cra. 15 #93-47', city: 'Bogotá',
    state: 'Cundinamarca', pincode: '110221', country: 'Colombia', phone: '+57 310 555 0147',
  };
  await Cart.insertMany([
    { consumer_id: consumerUser._id, product_id: products[0]._id,  quantity: 1, sub_total: 149900 },
    { consumer_id: consumerUser._id, product_id: products[5]._id,  quantity: 1, sub_total: 149900 },
    { consumer_id: consumerUser._id, product_id: products[17]._id, quantity: 1, sub_total: 319900 },
  ]);
  await Order.insertMany([
    {
      order_number: 2001,
      consumer_id: consumerUser._id,
      products: [
        { product_id: products[1]._id, name: products[1].name, quantity: 1, price: 249900, sub_total: 249900 },
        { product_id: products[7]._id, name: products[7].name, quantity: 1, price: 399900, sub_total: 399900 },
      ],
      billing_address: direccionBogota, shipping_address: direccionBogota,
      payment_method: 'card', payment_status: 'paid',
      amount: 649800, total: 649800,
      status_id: ST('delivered')._id,
    },
    {
      order_number: 2002,
      consumer_id: consumerUser._id,
      products: [
        { product_id: products[9]._id,  name: products[9].name,  quantity: 1, price: 139900, sub_total: 139900 },
        { product_id: products[10]._id, name: products[10].name, quantity: 3, price: 62900,  sub_total: 188700 },
        { product_id: products[21]._id, name: products[21].name, quantity: 1, price: 72900,  sub_total: 72900  },
      ],
      billing_address: direccionBogota, shipping_address: direccionBogota,
      payment_method: 'cod', payment_status: 'pending',
      amount: 401500, total: 401500,
      status_id: ST('shipped')._id,
    },
    {
      order_number: 2003,
      consumer_id: consumerUser._id,
      products: [
        { product_id: products[24]._id, name: products[24].name, quantity: 1, price: 329900, sub_total: 329900 },
        { product_id: products[29]._id, name: products[29].name, quantity: 1, price: 229900, sub_total: 229900 },
      ],
      billing_address: direccionBogota, shipping_address: direccionBogota,
      payment_method: 'card', payment_status: 'paid',
      amount: 559800, total: 559800,
      status_id: ST('processing')._id,
    },
  ]);
  await Wishlist.insertMany([
    { consumer_id: consumerUser._id, product_id: products[2]._id  },
    { consumer_id: consumerUser._id, product_id: products[8]._id  },
    { consumer_id: consumerUser._id, product_id: products[15]._id },
    { consumer_id: consumerUser._id, product_id: products[23]._id },
  ]);
  console.log('Carrito / Pedidos / Listas de Deseos creados');

  // ── 14. Cupones ──────────────────────────────────────────────────────────────
  await Coupon.insertMany([
    { title: 'Regalo de Bienvenida', code: 'BIENVENIDO15', description: '15% de descuento en tu primer pedido — sin monto mínimo.', type: 'percentage', amount: 15, min_spend: 0, is_unlimited: true, status: 1, created_by_id: adminUser._id },
    { title: 'Ofertas de Temporada', code: 'VERANO20',     description: '20% de descuento en artículos en oferta — tiempo limitado.',     type: 'percentage', amount: 20, min_spend: 50000, is_unlimited: true, status: 1, created_by_id: adminUser._id },
    { title: 'Envío Gratis',         code: 'ENVIOGRATIS',  description: 'Envío estándar gratis en cualquier pedido.',                       type: 'fixed',      amount: 15000, min_spend: 0, is_unlimited: true, status: 1, created_by_id: adminUser._id },
    { title: '$25.000 en Compras +$150.000', code: 'ESTILO25', description: '$25.000 de descuento en pedidos superiores a $150.000.',     type: 'fixed',      amount: 25000, min_spend: 150000, is_unlimited: true, status: 1, created_by_id: adminUser._id },
  ]);

  // ── 15. Envíos ────────────────────────────────────────────────────────────────
  await Shipping.create({
    status: 1,
    country: 'Colombia', country_id: 48,
    shipping_rules: [
      { name: 'Envío Estándar (5–7 días hábiles)',   type: 'flat', amount: 9900  },
      { name: 'Envío Express (2–3 días hábiles)',     type: 'flat', amount: 19900 },
      { name: 'Envío al Día Siguiente',               type: 'flat', amount: 34900 },
      { name: 'Envío Gratis (pedidos +$200.000)',     type: 'free', amount: 0     },
    ],
    created_by_id: adminUser._id,
  });

  // ── 16. Blogs ─────────────────────────────────────────────────────────────────
  const blogImgs = await Promise.all([
    att('blog-capsule-wardrobe', 900, 500, 'blog-1'),
    att('blog-summer-trends',   900, 500, 'blog-2'),
    att('blog-menswear-guide',  900, 500, 'blog-3'),
    att('blog-denim-styling',   900, 500, 'blog-4'),
    att('blog-accessories',     900, 500, 'blog-5'),
  ]);

  await Blog.insertMany([
    {
      title: 'Cómo Construir un Guardarropa Cápsula en 10 Prendas',
      slug: 'guardarropa-capsula-10-prendas',
      description: 'Un guardarropa atemporal no requiere un clóset enorme. Descubre las 10 prendas esenciales que forman la base de un guardarropa versátil.',
      content: `<p>Un guardarropa cápsula es una colección curada de prendas versátiles y atemporales que funcionan perfectamente juntas. El concepto fue popularizado por Susie Faux en los años 70.</p>
<h2>Las 10 Prendas Esenciales</h2>
<ol>
  <li><strong>La Camiseta Blanca Perfecta</strong> — En algodón de alta gramaje. Combina con absolutamente todo.</li>
  <li><strong>Jeans Rectos Lavado Oscuro</strong> — El lavado oscuro es el más versátil. Funciona formal e informal.</li>
  <li><strong>Un Blazer Entallado</strong> — En azul marino o gris carbón. Eleva cualquier look instantáneamente.</li>
  <li><strong>Una Gabardina Clásica</strong> — La prenda de abrigo definitiva. Camel o beige funciona en todas las estaciones.</li>
  <li><strong>Un Vestido Negro Midi</strong> — Atemporal. El corte correcto favorece todo tipo de figura.</li>
  <li><strong>Zapatillas de Cuero Blanco</strong> — Las más versátiles que tendrás. Formal o informal.</li>
  <li><strong>Camisa Oxford Clásica</strong> — En blanco o azul claro. Pilar del estilo smart-casual.</li>
  <li><strong>Pantalón Sastre Negro</strong> — Slim o pierna ancha. Versátil al infinito.</li>
  <li><strong>Una Cartera de Cuero de Calidad</strong> — Tote estructurado o cruzado. Negro o camel. Invierte aquí.</li>
  <li><strong>Un Suéter Fino</strong> — Cuello redondo o en V. Tono neutro. La definición de la elegancia sin esfuerzo.</li>
</ol>
<p>Con estas 10 prendas puedes crear más de 50 outfits distintos. Calidad sobre cantidad — invierte en las mejores versiones que puedas permitirte y te recompensarán por años.</p>`,
      is_featured: true, is_sticky: true, status: 1,
      blog_thumbnail_id: blogImgs[0]._id,
      categories: [cWomen._id, cMen._id],
      tags: ['Guía de Estilo', 'Lookbook'],
      created_by_id: adminUser._id,
    },
    {
      title: 'Tendencias de Moda 2026 Que Debes Conocer',
      slug: 'tendencias-moda-2026',
      description: 'Del amarillo mantequilla a las capas transparentes — las tendencias que dominan el 2026 son audaces, divertidas y sorprendentemente usables.',
      content: `<p>El 2026 marca un cambio del lujo silencioso al maximalismo expresivo. Estas son las tendencias clave:</p>
<h2>1. Amarillo Mantequilla</h2>
<p>El color de la temporada. Desde vestidos slip hasta blazers sastre, el amarillo mantequilla ha superado al beige como el nuevo neutro.</p>
<h2>2. Transparencias</h2>
<p>La transparencia es tendencia. Capas de blusas transparentes sobre tops o faldas veladas sobre ciclistas para un look moderno.</p>
<h2>3. Pantalón Palazzo</h2>
<p>El reinado del jean skinny terminó. Las siluetas palazzo, de pierna ancha y acampanada dominan los pantalones esta temporada.</p>
<h2>4. Detalles Metálicos</h2>
<p>Un destello de metal eleva cualquier look de ordinario a extraordinario. Blazers metálicos, calzado plateado o accesorios dorados.</p>
<h2>5. Estilo Abuela Costera</h2>
<p>Camisas de lino, sombreros de ala ancha, alpargatas y tonos neutros — elegantemente cómodo y atemporalmente chic.</p>`,
      is_featured: true, status: 1,
      blog_thumbnail_id: blogImgs[1]._id,
      categories: [cWomen._id],
      tags: ['Tendencias', 'Verano'],
      created_by_id: adminUser._id,
    },
    {
      title: 'Guía de Estilo Masculino: 5 Reglas para Vestir Mejor',
      slug: 'guia-estilo-masculino-5-reglas',
      description: 'Vestir bien no tiene que ser complicado. Estas 5 reglas transformarán cómo luces y te sientes.',
      content: `<p>El buen estilo no es usar la ropa más cara — es entender el corte, el color y el contexto. Domina estas 5 reglas y siempre lucirás impecable.</p>
<h2>Regla 1: El Corte Es Todo</h2>
<p>Una camisa de $50.000 que queda perfecta luce mejor que una de $500.000 que no queda bien. Lleva tu ropa a un sastre. Cuesta poco y hace una diferencia transformadora.</p>
<h2>Regla 2: Construye Alrededor de Neutros</h2>
<p>Azul marino, blanco, gris, negro y caqui forman la columna vertebral de un guardarropa versátil. Agrega color a través de accesorios.</p>
<h2>Regla 3: Invierte en Calzado de Calidad</h2>
<p>La gente nota los zapatos. Un buen par de botines Chelsea de cuero o zapatillas clásicas eleva cualquier look instantáneamente.</p>
<h2>Regla 4: Menos Es Más</h2>
<p>Un look limpio y austero casi siempre luce más sofisticado que uno sobre-accesorizado.</p>
<h2>Regla 5: El Cuidado Personal Completa el Look</h2>
<p>La mejor ropa del mundo pierde valor con un cuidado personal descuidado. El cabello limpio y la piel bien cuidada son tan importantes como lo que vistes.</p>`,
      is_featured: true, status: 1,
      blog_thumbnail_id: blogImgs[2]._id,
      categories: [cMen._id],
      tags: ['Guía de Estilo', 'Tendencias'],
      created_by_id: adminUser._id,
    },
    {
      title: 'La Guía Definitiva del Denim',
      slug: 'guia-definitiva-del-denim',
      description: 'Del selvedge oscuro al denim distressed — cómo lucir cada silueta de denim en tu guardarropa.',
      content: `<p>El denim es quizás la tela más democrática de la moda. Un buen par de jeans puede anclar todo un guardarropa. Así es como dominar cada silueta.</p>
<h2>Recto Lavado Oscuro</h2>
<p>El corte más versátil. Con camisa blanca y mocasines para smart-casual, o con camiseta gráfica y tenis para el fin de semana.</p>
<h2>Skinny de Tiro Alto</h2>
<p>Mejor con tops oversize o blusas entucadas. El tiro alto alarga la pierna — combínalo con una chaqueta ligeramente corta para definir la cintura.</p>
<h2>Pierna Ancha y Barril</h2>
<p>La silueta del momento. Equilibra el volumen con un top entallado fruncido hacia adelante.</p>
<h2>Distressed y Lavado Vintage</h2>
<p>Mantén todo lo demás limpio y minimal para dejar que la textura hable. Una camiseta blanca y zapatillas simples hacen brillar el denim distressed.</p>`,
      status: 1,
      blog_thumbnail_id: blogImgs[3]._id,
      categories: [cWomen._id, cMen._id],
      tags: ['Guía de Estilo', 'Lookbook'],
      created_by_id: adminUser._id,
    },
    {
      title: 'Accesorios Que Transforman Cualquier Look',
      slug: 'accesorios-que-transforman-cualquier-look',
      description: 'Los accesorios correctos pueden convertir un outfit básico en una declaración de moda. Estas son las piezas que vale la pena invertir.',
      content: `<p>Los accesorios son la puntuación de un outfit — le dan personalidad, énfasis y acabado. Estas son las piezas que vale la pena invertir.</p>
<h2>La Cartera de Cuero de Calidad</h2>
<p>Un tote estructurado o cruzado en tono neutro (negro, camel o beige) funciona para cualquier ocasión. El cuero desarrolla una hermosa pátina — mientras más lo usas, mejor luce.</p>
<h2>Aretes Argollas Doradas</h2>
<p>Un par de argollas doradas de calidad es la compra de joyería más versátil que puedes hacer. Funcionan con todo, desde un blazer hasta un vestido de baño.</p>
<h2>La Pañoleta de Seda</h2>
<p>Las pañoletas 100% seda tienen infinitas posibilidades de styling. En el cabello, al cuello, anudada en la cartera o como top. Una pañoleta, infinitos outfits.</p>
<h2>Un Reloj de Calidad</h2>
<p>Un buen reloj agrega autoridad e intención inmediata a cualquier look.</p>
<h2>Gafas de Sol Clásicas</h2>
<p>Invierte en un buen par. Las formas clásicas (ovaladas, rectangulares, tipo ojo de gato) superan las tendencias por décadas.</p>`,
      status: 1,
      blog_thumbnail_id: blogImgs[4]._id,
      categories: [cAcc._id],
      tags: ['Guía de Estilo', 'Tendencias'],
      created_by_id: adminUser._id,
    },
  ]);
  console.log('Blogs creados');

  // ── 17. Notificaciones ────────────────────────────────────────────────────────
  await Notification.insertMany([
    { notifiable_id: consumerUser._id, data: { title: '¡Bienvenida a XDOPE Store!', message: 'Gracias por unirte. Usa el código BIENVENIDO15 para obtener 15% de descuento en tu primer pedido.', type: 'welcome' } },
    { notifiable_id: consumerUser._id, data: { title: 'Pedido Enviado 🚀', message: 'Tu pedido #2002 ha sido enviado y está en camino.', type: 'order' } },
  ]);

  // ── 18. Menú ──────────────────────────────────────────────────────────────────
  await Menu.insertMany([
    { title: 'Inicio', path: '/', class: '0', status: 1, sort_order: 0 },
    {
      title: 'Mujer', path: `/collections?category=${cWomen.slug}`, class: '0', status: 1, sort_order: 1,
      megamenu: true,
      item: [
        { title: 'Vestidos',         path: `/collections?category=${cDresses.slug}` },
        { title: 'Blusas y Tops',    path: `/collections?category=${cTops.slug}` },
        { title: 'Pantalones',       path: `/collections?category=${cPantsW.slug}` },
        { title: 'Faldas',           path: `/collections?category=${cSkirts.slug}` },
        { title: 'Abrigos',          path: `/collections?category=${cOuterW.slug}` },
        { title: 'Deportivo',        path: `/collections?category=${cActiveW.slug}` },
      ],
    },
    {
      title: 'Hombre', path: `/collections?category=${cMen.slug}`, class: '0', status: 1, sort_order: 2,
      megamenu: true,
      item: [
        { title: 'Camisetas',        path: `/collections?category=${cTshirts.slug}` },
        { title: 'Camisas',          path: `/collections?category=${cShirts.slug}` },
        { title: 'Pantalones',       path: `/collections?category=${cPantsM.slug}` },
        { title: 'Abrigos',          path: `/collections?category=${cOuterM.slug}` },
        { title: 'Deportivo',        path: `/collections?category=${cActiveM.slug}` },
      ],
    },
    {
      title: 'Accesorios', path: `/collections?category=${cAcc.slug}`, class: '0', status: 1, sort_order: 3,
      item: [
        { title: 'Bolsos y Carteras', path: `/collections?category=${cBags.slug}` },
        { title: 'Joyería',           path: `/collections?category=${cJewelry.slug}` },
        { title: 'Sombreros y Gorras',path: `/collections?category=${cHats.slug}` },
      ],
    },
    {
      title: 'Calzado', path: `/collections?category=${cShoes.slug}`, class: '0', status: 1, sort_order: 4,
      item: [
        { title: 'Calzado Mujer', path: `/collections?category=${cShoesW.slug}` },
        { title: 'Calzado Hombre',path: `/collections?category=${cShoesM.slug}` },
      ],
    },
    { title: 'Ofertas', path: `/collections?category=${cSale.slug}`,  class: '0', status: 1, sort_order: 5 },
    { title: 'Blog',    path: '/blogs',                                class: '0', status: 1, sort_order: 6 },
  ]);
  console.log('Menú creado');

  // ── 19. Opciones del Tema ─────────────────────────────────────────────────────
  const logoImg     = await Attachment.create({ name: 'xdope-logo.svg', file_name: 'xdope-logo.svg', mime_type: 'image/svg+xml', original_url: '/xdope-logo.svg', asset_url: '/xdope-logo.svg' });
  const darkLogo    = logoImg;
  const favicon     = await att('xdope-favicon', 32, 32,  'favicon');
  const heroBanner1 = await att('xdope-hero-1', 1600, 600,'hero-1');

  await ThemeOption.create({
    options: {
      general: {
        primary_color:   '#2c1810',
        secondary_color: '#c9a96e',
        mode: 'light-only',
      },
      logo: {
        header_logo:  { id: logoImg._id,  original_url: logoImg.original_url  },
        footer_logo:  { id: darkLogo._id, original_url: darkLogo.original_url },
        favicon_icon: { id: favicon._id,  original_url: favicon.original_url  },
      },
      header: {
        header_options: 'classic_header',
        sticky_header_enable: true,
        header_border_enable: false,
      },
      footer: {
        footer_copyright: '© 2026 XDOPE Store. Todos los derechos reservados.',
        support_number: '+57 310 555 0147',
        support_email: 'soporte@xdope.com',
      },
      collection: { collection_layout: 'collection_left_sidebar', product_per_page: 12 },
      product:    { product_layout: 'product_images', product_box: 'product_box_one', product_box_variant: 'product_box_one', show_trending_label: true, show_sale_label: true },
      seo: {
        meta_tags:        'XDOPE Store — Moda de Vanguardia Colombia',
        meta_description: 'Compra la última moda para mujer y hombre en XDOPE Store Colombia. Envío a todo el país.',
        og_title:         'XDOPE Store',
        og_description:   'Descubre ropa, accesorios y calzado de tendencia en Colombia.',
        og_image: { id: heroBanner1._id, original_url: heroBanner1.original_url },
      },
      popup: {
        news_letter: {
          status: true,
          image: { id: heroBanner1._id, original_url: heroBanner1.original_url },
          title: '¡Únete a la Familia XDOPE!',
          content: 'Suscríbete para acceso exclusivo a nuevas colecciones, consejos de moda y 15% de descuento en tu primer pedido.',
        },
      },
    },
  });
  console.log('Opciones del tema creadas');

  // ── 20. Configuración de la página de inicio ──────────────────────────────────
  const allProductIds  = products.map(p => String(p._id));
  const allBrandIds    = brands.map(b => String(b._id));
  const featuredIds    = products.filter(p => p.is_featured).map(p => String(p._id));
  const tabCategoryIds = [
    String(cDresses._id), String(cTops._id), String(cPantsW._id),
    String(cTshirts._id), String(cShirts._id), String(cPantsM._id),
    String(cBags._id), String(cShoesW._id), String(cShoesM._id),
  ];

  const homeConfig = {
    products_ids: allProductIds,
    home_banner: {
      status: 1,
      banners: [
        { status: 1, original_url: img('xdope-hero-women', 1835, 627), title: 'Nueva Temporada', subtitle: 'Colección Mujer 2026', button_text: 'Ver Mujer', redirect_link: { link_type: 'collection', link: cWomen.slug }, text_position: 'center' },
        { status: 1, original_url: img('xdope-hero-men',   1835, 627), title: 'Esenciales Refinados', subtitle: 'Edición Hombre 2026', button_text: 'Ver Hombre', redirect_link: { link_type: 'collection', link: cMen.slug }, text_position: 'left' },
        { status: 1, original_url: img('xdope-hero-sale',  1835, 627), title: 'Hasta 25% de Descuento', subtitle: 'Ofertas Activas', button_text: 'Ver Ofertas', redirect_link: { link_type: 'collection', link: cSale.slug }, text_position: 'right' },
      ],
    },
    offer_banner: {
      banner_1: { status: 1, original_url: img('xdope-offer-accessories', 676, 338), title: 'Accesorios', subtitle: 'Nuevos Ingresos', redirect_link: { link_type: 'collection', link: cAcc.slug }, text_bg: false, text_position: 'left' },
      banner_2: { status: 1, original_url: img('xdope-offer-shoes',       676, 338), title: 'Ofertas',     subtitle: 'Hasta 25% Off',   redirect_link: { link_type: 'collection', link: cSale.slug }, text_bg: false, text_position: 'right' },
    },
    products_list: { status: 1, title: 'Favoritos Destacados', tag: 'Selección Especial', product_ids: featuredIds },
    category_product: { status: 1, title: 'Compra por Categoría', tag: 'Explora', category_ids: tabCategoryIds },
    brands: { brand_ids: allBrandIds },
    services: {
      status: 1,
      banners: [
        { status: 1, image_url: img('icon-shipping', 60, 60), title: 'Envío a Todo Colombia', description: 'En pedidos superiores a $200.000' },
        { status: 1, image_url: img('icon-returns',  60, 60), title: 'Devoluciones en 30 Días', description: 'Sin complicaciones' },
        { status: 1, image_url: img('icon-secure',   60, 60), title: 'Pago Seguro',            description: 'Transacciones 100% cifradas' },
        { status: 1, image_url: img('icon-support',  60, 60), title: 'Soporte 24/7',           description: 'Estamos para ayudarte' },
      ],
    },
    social_media: {
      status: 1,
      title: 'Síguenos en Instagram',
      tag: '@xdopestore',
      banners: [
        { status: 1, original_url: img('social-1', 400, 400) },
        { status: 1, original_url: img('social-2', 400, 400) },
        { status: 1, original_url: img('social-3', 400, 400) },
        { status: 1, original_url: img('social-4', 400, 400) },
        { status: 1, original_url: img('social-5', 400, 400) },
        { status: 1, original_url: img('social-6', 400, 400) },
      ],
    },
    parallax_banner: { status: 0 },
  };

  await Homepage.insertMany([
    { slug: 'fashion_one', config: homeConfig },
    { slug: 'default',     config: homeConfig },
  ]);
  console.log('Configuración de inicio creada');

  console.log('\n✅ Semilla XDOPE Store Colombia completada!');
  console.log('━'.repeat(50));
  console.log(`  Admin:      ${adminUser.email}  /  ${process.env.ADMIN_PASSWORD || 'Admin@123'}`);
  console.log(`  Consumidor: ${consumerUser.email}  /  Consumer@123`);
  console.log('━'.repeat(50));
  console.log(`  Moneda:     Peso Colombiano (COP)`);
  console.log(`  Impuesto:   IVA 19%`);
  console.log(`  Categorías: 6 padres + 16 subcategorías`);
  console.log(`  Productos:  ${products.length} (con variaciones de talla/color)`);
  console.log(`  Marcas:     ${brands.length}`);
  console.log(`  Cupones:    BIENVENIDO15 · VERANO20 · ENVIOGRATIS · ESTILO25`);
  console.log(`  Pedidos:    3  |  Listas de deseos: 4  |  Carrito: 3`);

  await mongoose.disconnect();
}

seed().catch(e => { console.error('Semilla fallida:', e); process.exit(1); });
