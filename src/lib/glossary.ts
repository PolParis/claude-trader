// Glosario: conceptos básicos fijos. Los que Claude explica en cada ejecución se añaden en la web.
export const BASICS: { term: string; meaning: string }[] = [
  { term: "Acción", meaning: "Un trozo pequeño de una empresa. Si a la empresa le va bien y más gente quiere sus acciones, el precio sube; si le va mal, baja." },
  { term: "Fondo indexado o ETF", meaning: "Una cesta que contiene muchas acciones a la vez (por ejemplo, las 500 mayores empresas de EE. UU.). Comprar una cesta reparte el riesgo: si una empresa se hunde, las otras compensan." },
  { term: "Índice de referencia (benchmark)", meaning: "Lo que habría conseguido alguien que el primer día metió los 10.000 € en un fondo indexado y no hizo nada más. Claude intenta hacerlo mejor que eso." },
  { term: "Rentabilidad", meaning: "Cuánto ha ganado o perdido la cartera en porcentaje. +5 % sobre 10.000 € son 500 € de ganancia." },
  { term: "Comisión y slippage", meaning: "Lo que cuesta cada operación: una comisión del 0,10 % (mínimo 1 €) y un pequeño sobreprecio (0,05 %) por no comprar exactamente al precio de pantalla. Operar mucho sale caro." },
  { term: "Diversificar", meaning: "No poner todos los huevos en la misma cesta: repartir el dinero entre países, sectores y tipos de activo para que un mal golpe en uno no hunda todo." },
  { term: "Riesgo de divisa", meaning: "Muchas acciones cotizan en dólares. Si el euro sube frente al dólar, esas acciones valen menos euros aunque su precio en dólares no cambie." },
];

// Evita repetir en el glosario un concepto que ya está entre los básicos (p. ej. "ETF").
const stem = (t: string) => t.toLowerCase().slice(0, 6);
export const isBasic = (term: string) => BASICS.some((b) => stem(b.term) === stem(term) || b.term.toLowerCase().includes(term.toLowerCase()));
