/**
 * Ciudades de Colombia agrupadas por departamento, para el desplegable de
 * ciudad en las direcciones y para el cálculo de envío por zonas.
 *
 * ZONE1 = ciudades principales y sus áreas metropolitanas (tarifa Zona 1).
 * Toda ciudad que no esté en ZONE1 — incluida "Otra ciudad" — cobra Zona 2.
 * La lista es curada (no los 1.100+ municipios); el formulario ofrece
 * "Otra ciudad" con texto libre para el resto.
 */

const CITIES_BY_DEPARTMENT = {
  'Amazonas': ['Leticia'],
  'Antioquia': ['Medellín', 'Bello', 'Itagüí', 'Envigado', 'Sabaneta', 'La Estrella', 'Caldas', 'Copacabana', 'Girardota', 'Rionegro', 'Apartadó', 'Turbo', 'Caucasia'],
  'Arauca': ['Arauca'],
  'Atlántico': ['Barranquilla', 'Soledad', 'Malambo', 'Puerto Colombia', 'Sabanalarga'],
  'Bogotá D.C.': ['Bogotá'],
  'Bolívar': ['Cartagena', 'Magangué', 'Turbaco'],
  'Boyacá': ['Tunja', 'Duitama', 'Sogamoso', 'Chiquinquirá'],
  'Caldas': ['Manizales', 'Villamaría', 'La Dorada', 'Chinchiná'],
  'Caquetá': ['Florencia'],
  'Casanare': ['Yopal'],
  'Cauca': ['Popayán', 'Santander de Quilichao'],
  'Cesar': ['Valledupar', 'Aguachica'],
  'Chocó': ['Quibdó'],
  'Córdoba': ['Montería', 'Cereté', 'Sahagún', 'Lorica'],
  'Cundinamarca': ['Soacha', 'Chía', 'Zipaquirá', 'Facatativá', 'Mosquera', 'Madrid', 'Funza', 'Fusagasugá', 'Cajicá', 'Girardot', 'Sopó'],
  'Guainía': ['Inírida'],
  'Guaviare': ['San José del Guaviare'],
  'Huila': ['Neiva', 'Pitalito', 'Garzón'],
  'La Guajira': ['Riohacha', 'Maicao'],
  'Magdalena': ['Santa Marta', 'Ciénaga'],
  'Meta': ['Villavicencio', 'Acacías', 'Granada'],
  'Nariño': ['Pasto', 'Ipiales', 'Tumaco'],
  'Norte de Santander': ['Cúcuta', 'Los Patios', 'Villa del Rosario', 'Ocaña', 'Pamplona'],
  'Putumayo': ['Mocoa', 'Puerto Asís'],
  'Quindío': ['Armenia', 'Calarcá', 'Montenegro', 'Quimbaya'],
  'Risaralda': ['Pereira', 'Dosquebradas', 'Santa Rosa de Cabal', 'La Virginia'],
  'San Andrés y Providencia': ['San Andrés'],
  'Santander': ['Bucaramanga', 'Floridablanca', 'Girón', 'Piedecuesta', 'Barrancabermeja', 'San Gil'],
  'Sucre': ['Sincelejo', 'Corozal'],
  'Tolima': ['Ibagué', 'Espinal', 'Melgar', 'Honda'],
  'Valle del Cauca': ['Cali', 'Palmira', 'Yumbo', 'Jamundí', 'Buenaventura', 'Tuluá', 'Buga', 'Cartago'],
  'Vaupés': ['Mitú'],
  'Vichada': ['Puerto Carreño'],
};

// Ciudades principales + áreas metropolitanas — tarifa Zona 1.
const ZONE1_CITIES = new Set([
  'Bogotá', 'Soacha', 'Chía', 'Zipaquirá', 'Mosquera', 'Madrid', 'Funza', 'Cajicá',
  'Medellín', 'Bello', 'Itagüí', 'Envigado', 'Sabaneta', 'La Estrella', 'Copacabana',
  'Cali', 'Palmira', 'Yumbo', 'Jamundí',
  'Barranquilla', 'Soledad', 'Puerto Colombia',
  'Cartagena',
  'Bucaramanga', 'Floridablanca', 'Girón', 'Piedecuesta',
  'Cúcuta', 'Los Patios', 'Villa del Rosario',
  'Pereira', 'Dosquebradas',
  'Manizales', 'Villamaría',
  'Armenia', 'Calarcá',
  'Ibagué',
  'Santa Marta',
  'Villavicencio',
  'Pasto',
  'Montería',
  'Neiva',
  'Popayán',
  'Tunja',
  'Valledupar',
  'Sincelejo',
]);

// Normaliza para comparar: minúsculas y sin tildes ("BOGOTA" == "Bogotá").
function normalizeCity(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const ZONE1_NORMALIZED = new Set([...ZONE1_CITIES].map(normalizeCity));

function isZone1City(city) {
  return ZONE1_NORMALIZED.has(normalizeCity(city));
}

module.exports = { CITIES_BY_DEPARTMENT, ZONE1_CITIES, isZone1City, normalizeCity };
