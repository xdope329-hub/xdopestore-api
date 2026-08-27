require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Page = require('../src/models/Page');

/**
 * Inserta SOLO las páginas legales (Términos y Condiciones, Política de
 * Privacidad) sin tocar ningún otro dato de la base. Seguro para producción.
 *
 * - Si la página (por slug) no existe, la crea.
 * - Si ya existe, NO la sobreescribe (así no se pierden ediciones hechas
 *   desde el admin). Usa --force para reemplazar el contenido existente.
 *
 * Uso:  npm run seed:pages        (solo crea las que falten)
 *       npm run seed:pages -- --force   (reemplaza también las existentes)
 */
async function run() {
  const FORCE = process.argv.includes('--force');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado a MongoDB');

  const adminUser = await User.findOne({ 'system_reserve': '1' }).sort({ createdAt: 1 })
    || await User.findOne().sort({ createdAt: 1 });

  const pages = [
    {
      title: 'Términos y Condiciones',
      slug: 'terms-and-conditions',
      content: `<p><em>Última actualización: 27 de agosto de 2026</em></p>
<p>Bienvenido a XDOPE Store. Al comprar en nuestra tienda aceptas estos términos. Los escribimos simples y claros para que sepas exactamente qué esperar.</p>
<h3>1. Quiénes somos</h3>
<p>XDOPE Store es una marca de moda con sede en Bogotá, Colombia. Por ahora vendemos una sola cosa y la hacemos bien: hoodies con diseños bordados.</p>
<p>¿Dudas? Escríbenos a soporte@xdope.com o llámanos al +57 310 555 0147.</p>
<h3>2. Compras y pagos</h3>
<p>Los precios están en pesos colombianos (COP) e incluyen IVA. El precio válido es el publicado al momento de confirmar tu pedido; el envío se muestra por separado antes de pagar.</p>
<p>Puedes pagar con Mercado Pago (tarjetas, PSE y demás medios habilitados) o contra entrega en efectivo donde el servicio esté disponible. Los pagos con tarjeta los procesa Mercado Pago en sus servidores seguros: nunca vemos ni guardamos los datos de tu tarjeta.</p>
<h3>3. Envíos</h3>
<p>Enviamos a todo Colombia con transportadoras aliadas:</p>
<ul><li>Estándar: 5 a 7 días hábiles.</li><li>Express: 2 a 3 días hábiles.</li><li>Día siguiente: en ciudades principales, según cobertura.</li><li>Gratis en pedidos superiores a $200.000 COP.</li></ul>
<h3>4. Cambios y devoluciones</h3>
<p>Tienes 30 días calendario desde la entrega para cambiar de talla o devolver tu hoodie, siempre que esté sin uso, sin lavar y con su etiqueta original.</p>
<p>Además, por ley (artículo 47, Ley 1480 de 2011) puedes retractarte de la compra dentro de los 5 días hábiles siguientes a la entrega, sin dar explicaciones; en ese caso el envío de la devolución corre por tu cuenta y te reembolsamos dentro de los 30 días siguientes.</p>
<p>Los hoodies con bordados personalizados hechos a tu medida o pedido no tienen cambio ni retracto, salvo defecto de fabricación.</p>
<h3>5. Garantía</h3>
<p>Todos nuestros hoodies tienen la garantía legal de la Ley 1480 de 2011 frente a defectos de confección, materiales o bordado.</p>
<p>La garantía no cubre el desgaste normal por uso ni daños causados por lavar o cuidar la prenda contra las instrucciones de la etiqueta. Tip: lava tu hoodie al revés y con agua fría para proteger el bordado.</p>
<p>Si tu hoodie llega con un defecto, escríbenos con tu número de pedido y lo resolvemos con reparación, cambio o devolución del dinero, según corresponda.</p>
<h3>6. Tu cuenta</h3>
<p>Puedes crear una cuenta con tus datos o entrar con Google. Cuida tus credenciales: lo que se haga desde tu cuenta se entiende hecho por ti. Podemos suspender cuentas con información falsa o uso fraudulento.</p>
<h3>7. Lo que no está en nuestras manos</h3>
<p>Hacemos nuestro mejor esfuerzo, pero en la máxima medida permitida por la ley colombiana, XDOPE Store no se hace responsable por:</p>
<ul><li>Pequeñas variaciones de color entre la foto y la prenda: cada pantalla muestra los colores distinto y cada bordado es único.</li><li>Retrasos de las transportadoras o causas de fuerza mayor ajenas a nuestro control.</li><li>Fallas temporales del sitio, de internet o de las pasarelas de pago.</li><li>El mal uso del sitio o de tu cuenta.</li></ul>
<h3>8. Tus datos y la ley aplicable</h3>
<p>Tratamos tus datos según nuestra Política de Privacidad y la Ley 1581 de 2012.</p>
<p>Estos términos se rigen por las leyes de Colombia. La autoridad de protección al consumidor es la Superintendencia de Industria y Comercio (SIC) — www.sic.gov.co.</p>
<h3>9. Cambios a estos términos</h3>
<p>Podemos actualizar estos términos cuando sea necesario. La versión vigente es siempre la publicada en esta página; tu compra se rige por los términos vigentes al momento de hacerla.</p>`,
      meta_title: 'Términos y Condiciones | XDOPE Store',
      meta_description: 'Términos y condiciones de XDOPE Store: compra de hoodies con diseños bordados, pagos, envíos, cambios, devoluciones y garantía en Colombia.',
      status: 1,
    },
    {
      title: 'Política de Privacidad',
      slug: 'privacy-policy',
      content: `<p><em>Última actualización: 27 de agosto de 2026</em></p>
<p>En XDOPE Store pedimos solo los datos necesarios para venderte un hoodie y entregártelo. Esta política, escrita en lenguaje simple, cumple la Ley 1581 de 2012 (habeas data) y te cuenta qué guardamos, para qué y cómo borrarlo.</p>
<h3>1. Quién trata tus datos</h3>
<p>XDOPE Store, con sede en Bogotá, Colombia, es la responsable del tratamiento. Para cualquier tema de datos escríbenos a soporte@xdope.com o llámanos al +57 310 555 0147.</p>
<h3>2. Qué datos guardamos</h3>
<p>Solo lo necesario para operar la tienda:</p>
<ul><li>Tu cuenta: nombre, correo, teléfono y contraseña cifrada (o el perfil básico si entras con Google).</li><li>Tus pedidos: dirección de envío, historial de compras, cambios y devoluciones.</li><li>Cookies básicas para mantener tu sesión, tu idioma y tu carrito.</li></ul>
<h3>3. Lo que nunca guardamos ni hacemos</h3>
<p>No vemos ni almacenamos los datos de tu tarjeta: los procesa directamente Mercado Pago en sus servidores seguros.</p>
<p>No vendemos ni alquilamos tus datos a nadie. Solo los compartimos con quienes hacen posible tu pedido: Mercado Pago para el pago, la transportadora para la entrega (nombre, dirección y teléfono), Google si usas su inicio de sesión o reCAPTCHA, y las autoridades cuando la ley lo exige.</p>
<p>Solo te enviamos correos comerciales si te suscribes, y puedes darte de baja cuando quieras con un clic.</p>
<h3>4. Tus derechos</h3>
<p>Puedes conocer, actualizar, corregir o borrar tus datos, y revocar tu autorización, cuando quieras. La mayoría lo haces tú mismo desde "Mi cuenta"; para lo demás escríbenos a soporte@xdope.com y respondemos dentro de los plazos legales (10 días hábiles para consultas, 15 para reclamos).</p>
<p>Si crees que no te respondimos bien, puedes quejarte ante la Superintendencia de Industria y Comercio (SIC).</p>
<h3>5. Seguridad y responsabilidad</h3>
<p>Protegemos tus datos con contraseñas cifradas, conexión HTTPS y pasarelas de pago certificadas.</p>
<p>En la máxima medida permitida por la ley, XDOPE Store no se hace responsable por fallas de seguridad de servicios de terceros (como tu correo, tu red o tu dispositivo) ni por accesos causados por compartir tu contraseña. Usa una contraseña fuerte y única.</p>
<h3>6. Menores de edad</h3>
<p>La tienda es para mayores de 18 años. No recopilamos datos de menores a sabiendas; si crees que ocurrió, avísanos y los borramos.</p>
<h3>7. Cambios a esta política</h3>
<p>Si cambiamos esta política, publicamos aquí la nueva versión con su fecha. Guardamos tus datos solo mientras tengas cuenta activa o la ley nos obligue a conservarlos; después se eliminan de forma segura.</p>`,
      meta_title: 'Política de Privacidad | XDOPE Store',
      meta_description: 'Política de privacidad y tratamiento de datos personales de XDOPE Store conforme a la Ley 1581 de 2012 (habeas data).',
      status: 1,
    },
  ];

  for (const page of pages) {
    if (adminUser) page.created_by_id = adminUser._id;
    const existing = await Page.findOne({ slug: page.slug });
    if (existing && !FORCE) {
      console.log(`= ${page.slug} ya existe — sin cambios (usa --force para reemplazar)`);
      continue;
    }
    if (existing) {
      await Page.updateOne({ slug: page.slug }, { $set: page });
      console.log(`~ ${page.slug} reemplazada (--force)`);
    } else {
      await Page.create(page);
      console.log(`+ ${page.slug} creada`);
    }
  }

  await mongoose.disconnect();
  console.log('Listo.');
}

run().catch((err) => { console.error(err); process.exit(1); });
