import { BENCHMARKS } from "@/core/benchmarks";
import { MARKETS } from "@/core/calendar";
import { BASE_UNIVERSE, MAX_WATCHLIST_EXTRA } from "@/core/universe";
import { NoExperiment, Section } from "@/components/ui";
import { getContext } from "@/lib/data";
import { fmtDateTime, fmtEur, fmtPct } from "@/lib/format";

export default async function MetodologiaPage() {
  const { exp } = await getContext();
  if (!exp) return <NoExperiment />;
  const regions = [...new Set(BASE_UNIVERSE.map((u) => u.region))];

  return (
    <div className="space-y-4 text-sm leading-relaxed text-ink-2">
      <Section title="Aviso legal">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong className="text-ink">El dinero es 100 % ficticio.</strong> No hay ningún bróker ni cuenta real conectada: es una simulación (paper trading) con precios reales.</li>
          <li><strong className="text-ink">Nada de esta web es consejo financiero.</strong> Las decisiones las toma un modelo de IA como experimento; pueden ser erróneas.</li>
          <li><strong className="text-ink">El autor no replica estas operaciones</strong> con dinero real y desaconseja hacerlo.</li>
          <li>Rentabilidades pasadas, simuladas o no, no garantizan rentabilidades futuras.</li>
        </ul>
      </Section>

      <Section title="El experimento">
        <p>
          Claude (un modelo de IA de Anthropic) gestiona una cartera de {fmtEur(Number(exp.initial_capital))} ficticios en euros con el objetivo de obtener la mejor
          rentabilidad <em>ajustada al riesgo</em> frente a varios índices de referencia. Inicio: {exp.started_at ? <strong className="text-ink">{fmtDateTime(exp.started_at)}</strong> : "pendiente"}{" "}
          (la fecha se fija al lanzar el experimento y la base de datos impide cambiarla).
        </p>
        <p className="mt-2">
          Dos veces por día laborable (16:30 y 21:00, hora de Madrid) un script en el ordenador del autor reúne la cartera, las últimas 20 entradas del diario y los
          datos de mercado del momento, y se los pasa a Claude mediante <code>claude -p</code> (la suscripción del autor, sin API de pago). En esa llamada Claude{" "}
          <strong className="text-ink">no tiene acceso a internet, herramientas ni a la base de datos</strong>: solo lee el texto y devuelve un JSON con su diario,
          sus órdenes y cambios en su lista de seguimiento. Tiene prohibido usar precios o noticias de memoria y debe escribir el diario aunque no opere.
        </p>
        <p className="mt-2">
          Un <strong className="text-ink">motor de ejecución determinista</strong>, separado de Claude, valida y ejecuta las órdenes con las reglas de abajo. Si la
          llamada falla (límite de uso, error o el ordenador apagado), se registra como ejecución fallida y no se reintenta de forma que pueda duplicar órdenes: cada
          franja horaria se reserva una sola vez en la base de datos (restricción UNIQUE) junto con el equipo que la lanzó.
        </p>
        <p className="mt-2">
          Antes de decidir, un <strong className="text-ink">equipo</strong> prepara la reunión. Un motor cuantitativo (código) calcula el riesgo de la cartera
          (volatilidad, VaR, CVaR, beta), 5.000 escenarios de Monte Carlo, pruebas de estrés, correlaciones, un ranking por factores (momentum, tendencia, baja volatilidad y
          valor) y el post-mortem de cada operación pasada. Después, dos llamadas a Claude en paralelo, también sin herramientas, hacen de analista cuantitativo y de gestora de
          riesgos y escriben un memo cada una. El gestor recibe esos memos y el manual de estrategia de la academia. Cada viernes, la academia (otra llamada a Claude) revisa la
          semana con los datos y reescribe ese manual. Todo queda guardado en el registro encadenado y se puede ver en las páginas Oficina y Cuantitativo.
        </p>
        <p className="mt-2">
          El Monte Carlo usa bootstrap por bloques de 5 días reales del último año, con semilla fija (reproducible). Se le quita la tendencia pasada y se supone un 5 % anual
          para la bolsa: así mide el riesgo sin suponer que lo que más subió seguirá subiendo.
        </p>
        <p className="mt-2">
          Después de ejecutar las órdenes, una segunda llamada a Claude (también sin herramientas) redacta una <strong className="text-ink">explicación para
          principiantes</strong> de lo que ha hecho y de lo que el sistema le ha rechazado. Esa explicación no influye en ninguna orden y se guarda en el mismo
          registro append-only con hash encadenado.
        </p>
      </Section>

      <Section title="Reglas de ejecución">
        <ul className="list-disc space-y-1 pl-5">
          <li>Comisión: {fmtPct(Number(exp.commission_pct), false)} del importe, mínimo {fmtEur(Number(exp.commission_min))}. Slippage: {fmtPct(Number(exp.slippage_pct), false)} en contra. Comisión de cambio: {fmtPct(Number(exp.fx_fee_pct), false)}.</li>
          <li>Solo contado: sin apalancamiento, ventas en corto, derivados ni margen. {exp.allow_fractional ? "Se permiten fracciones." : "Solo unidades enteras."}</li>
          <li>Máximo {fmtPct(Number(exp.max_position_pct), false, 0)} de la cartera en un activo, comprobado en cada compra (si un activo supera el límite porque sube, no se fuerza la venta).</li>
          <li>Solo se opera con el mercado abierto: lo comprueban un calendario propio de horarios y festivos y el estado de sesión que da la fuente de datos. Fuera de horario la orden se rechaza y queda registrada.</li>
          <li>Órdenes a mercado: precio de cotización del momento de la ejecución ± slippage. Órdenes limitadas: válidas durante la sesión del día. Si el precio ya cumple el límite se ejecutan al momento; si no, quedan pendientes (reservando efectivo o acciones) y se revisan con barras de 5 minutos. Si se tocó el límite se ejecutan a ese precio; si no, caducan al cierre.</li>
          <li>Primero se ejecutan las ventas y después las compras. Se rechaza cualquier activo que no estuviera en los datos enviados a Claude en esa ejecución.</li>
          <li>Divisa base EUR. Los activos en USD se convierten con el tipo EUR/USD real del momento, que se guarda con cada operación.</li>
          <li>Dividendos: se abonan en bruto el día ex-dividendo (se ignoran impuestos). Los splits ajustan la cantidad de acciones.</li>
          <li>Cripto: {exp.allow_crypto ? "permitida" : "desactivada"}.</li>
        </ul>
      </Section>

      <Section title="Universo de inversión">
        <p>
          Acciones y ETFs líquidos que cotizan en <strong className="text-ink">EUR o USD</strong> en {Object.values(MARKETS).filter((m) => m.id !== "CRYPTO").map((m) => m.name).join(", ")}. La exposición a China, India, Latinoamérica y otros emergentes
          se consigue con ADRs y ETFs de país cotizados en EE. UU. o Xetra. Hay un universo base de {BASE_UNIVERSE.length} activos ({regions.join(", ")}) y Claude puede
          añadir hasta {MAX_WATCHLIST_EXTRA} más a su lista de seguimiento, siempre que cumplan bolsa y divisa permitidas.
        </p>
        <p className="mt-2">
          <strong className="text-ink">Mandato del autor:</strong> se le pide a Claude que no se limite a fondos indexados de Europa y EE. UU. y que busque
          oportunidades en acciones individuales de todo el mundo (China, India, Latinoamérica, Asia, Israel, Sudáfrica…), diversificando y justificando cada
          elección con los datos. Esto puede hacer que la cartera sea más arriesgada que los benchmarks.
        </p>
      </Section>

      <Section title="Benchmarks">
        <p>Se compran una sola vez, el día de inicio y al precio de ese momento, con el mismo capital y los mismos costes (comisión, slippage y unidades enteras; lo que sobra queda en efectivo):</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {BENCHMARKS.map((b) => (
            <li key={b.code}>
              <strong className="text-ink">{b.name}</strong>
              {b.symbol ? ` — ETF de acumulación ${b.symbol}` : " — mantener el capital sin invertir"}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Fuentes de datos y retraso">
        <ul className="list-disc space-y-1 pl-5">
          <li>Precios, histórico, dividendos, splits y titulares: <strong className="text-ink">Yahoo Finance</strong> (librería <code>yahoo-finance2</code>, gratuita y no oficial).</li>
          <li>Retraso declarado por Yahoo: unos 15 minutos en Nasdaq, Xetra, París y Madrid, 20 en NYSE y casi en tiempo real en Ámsterdam, NYSE Arca y divisas. Cada precio guarda la fuente, la hora de la cotización, la hora de la consulta y su antigüedad. Si un precio tiene más de {exp.max_quote_age_minutes} minutos, la orden se rechaza.</li>
          <li>Claude recibe ya calculados: rentabilidades a 5 días, 1, 3, 6 y 12 meses, volatilidad, RSI, distancia a la media de 200 sesiones y al máximo anual, PER, dividendo, capitalización, índices de contexto (VIX, bono a 10 años, petróleo, oro, EUR/USD) y titulares recientes.</li>
        </ul>
      </Section>

      <Section title="Supuestos y limitaciones">
        <ul className="list-disc space-y-1 pl-5">
          <li>No se simulan liquidez, horquillas ni impacto de mercado más allá del slippage fijo. Una orden se ejecuta entera o no se ejecuta.</li>
          <li>Los precios con retraso hacen que la ejecución sea al precio de hace unos minutos, no al real del instante.</li>
          <li>Se ignoran impuestos, retenciones de dividendos y costes de custodia.</li>
          <li>Yahoo Finance es una fuente no oficial: puede fallar, cambiar o dar algún dato erróneo. Los fallos quedan registrados.</li>
          <li>Claude solo decide dos veces al día. Si el ordenador está apagado, esa ejecución se registra como no realizada.</li>
          <li>Un periodo corto no permite sacar conclusiones estadísticas sobre la habilidad de nadie, humano o IA.</li>
        </ul>
      </Section>
    </div>
  );
}
