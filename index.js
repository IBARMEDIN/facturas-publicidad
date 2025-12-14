const http = require("http");
const fs = require("fs");
const path = require("path");

/* ================= CONFIG ================= */

const USUARIO_ACTUAL = "antonio@farmavazquez.com";
const MODO_PRUEBA = false;

const API_TOKEN = "06e70df0-aaf1-11ee-bae2-a37a2451cc56";
const TEAM_ID = "s9vR3WrdvHijnidTJ";
const DB_ID = "ykya5csft4b4";
const TABLE_ID = "ZD";

/* ================= HELPERS ================= */

function nowISO() {
  return new Date().toISOString();
}

function fechaES(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

function renderPage(content) {
  const base = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  return base.replace("{{CONTENT}}", content);
}

async function obtenerNombreLaboratorio(id) {
  if (!id) return "—";
  const r = await fetch(
    `https://api.ninox.com/v1/teams/${TEAM_ID}/databases/${DB_ID}/tables/A/records/${id}?style=names`,
    { headers: { Authorization: `Bearer ${API_TOKEN}` } }
  );
  if (!r.ok) return "—";
  const d = await r.json();
  return d.fields?.Nombre_del_laboratorio || "—";
}

/* ================= SERVER ================= */

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  /* ===== CSS ===== */
  if (url.pathname === "/styles.css") {
    res.writeHead(200, { "Content-Type": "text/css" });
    res.end(fs.readFileSync(path.join(__dirname, "styles.css")));
    return;
  }

  /* ================= POST ================= */

  if (req.method === "POST") {
    let body = "";
    for await (const c of req) body += c;
    const p = new URLSearchParams(body);

    const accion = p.get("accion");
    const numeroFactura = p.get("numeroFactura");
    const recordId = p.get("recordId");
    const fechaCobro = p.get("fechaCobro");
    const banco = p.get("banco");
    const importeMovimiento = Number(
      (p.get("importeMovimiento") || "").replace(",", ".")
    );
    const usuario = p.get("usuario");

    if (!recordId) {
      res.end(renderPage(`<p>Error interno: falta ID</p>`));
      return;
    }

    if (!Number.isFinite(importeMovimiento) || importeMovimiento <= 0) {
      res.end(renderPage(`<p>Importe inválido</p>`));
      return;
    }

    /* ===== CONFIRMACIÓN ===== */
    if (accion === "previsualizar") {
      res.end(renderPage(`
        <section class="card">
          <h2>Confirmar cobro</h2>

          <p><strong>Factura:</strong> ${numeroFactura}</p>
          <p><strong>Fecha:</strong> ${fechaES(fechaCobro)}</p>
          <p><strong>Banco:</strong> ${banco}</p>
          <p><strong>Importe:</strong> ${importeMovimiento.toFixed(2)} €</p>
          <p><strong>Usuario:</strong> ${usuario}</p>

          <form method="POST" onsubmit="return bloquear(this)">
            <input type="hidden" name="accion" value="confirmar">
            <input type="hidden" name="numeroFactura" value="${numeroFactura}">
            <input type="hidden" name="recordId" value="${recordId}">
            <input type="hidden" name="fechaCobro" value="${fechaCobro}">
            <input type="hidden" name="banco" value="${banco}">
            <input type="hidden" name="importeMovimiento" value="${importeMovimiento}">
            <input type="hidden" name="usuario" value="${usuario}">

            <button id="btn">✅ Confirmar cobro</button>

            <div id="spinner">
              <span class="loader"></span> Procesando…
            </div>

            <a href="/">Cancelar</a>
          </form>

          <script>
            function bloquear(f){
              document.getElementById("btn").disabled=true;
              document.getElementById("btn").innerText="Confirmando…";
              document.getElementById("spinner").style.display="flex";
              return true;
            }
          </script>
        </section>
      `));
      return;
    }

    /* ===== PUT REAL ===== */
    if (accion === "confirmar") {
      if (MODO_PRUEBA) {
        res.end(renderPage(`<pre>SIMULACIÓN OK</pre>`));
        return;
      }

      const r = await fetch(
        `https://api.ninox.com/v1/teams/${TEAM_ID}/databases/${DB_ID}/tables/${TABLE_ID}/records/${recordId}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${API_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            fields: {
              Pagada: "Pagada",
              "Fecha de cobro": fechaCobro,
              "Fecha + hora de cobro": nowISO(),
              Banco: banco,
              "Importe del movimiento": importeMovimiento,
              "Puesta en cobrado por": usuario
            }
          })
        }
      );

      if (!r.ok) {
        res.end(renderPage(`<pre>Error al guardar</pre>`));
        return;
      }

      res.end(renderPage(`
        <section class="card success">
          <h2>✅ Factura cobrada</h2>
          <p>${numeroFactura}</p>
          <a href="/">Volver</a>
        </section>
      `));
      return;
    }
  }

  /* ================= GET ================= */

  const numeroFactura = url.searchParams.get("factura");

  let resultado = "";

  if (numeroFactura) {
    const r = await fetch(
      `https://api.ninox.com/v1/teams/${TEAM_ID}/databases/${DB_ID}/tables/${TABLE_ID}/record`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ filters: { M1: numeroFactura } })
      }
    );

    const d = await r.json();

    if (!d?.fields || d.fields.Pagada === "Pagada") {
      resultado = `<p>No encontrada o ya pagada</p>`;
    } else {
      const lab = await obtenerNombreLaboratorio(d.fields.Laboratorios);
      const imp = Number(d.fields["Importe total fijo"]).toFixed(2);

      resultado = `
        <section class="card">
          <h2>Factura ${numeroFactura}</h2>
          <p><strong>Laboratorio:</strong> ${lab}</p>
          <p><strong>Importe:</strong> ${imp} €</p>

          <form method="POST">
            <input type="hidden" name="accion" value="previsualizar">
            <input type="hidden" name="numeroFactura" value="${numeroFactura}">
            <input type="hidden" name="recordId" value="${d.id}">
            <input type="hidden" name="usuario" value="${USUARIO_ACTUAL}">
            <input type="date" name="fechaCobro" value="${nowISO().slice(0,10)}">
            <input name="banco" value="BANCOFAR">
            <input name="importeMovimiento" value="${imp}">
            <button>Registrar cobro</button>
          </form>
        </section>
      `;
    }
  }

  res.end(renderPage(`
    <section class="card">
      <h2>Buscar factura</h2>
      <form method="GET">
        <input name="factura" placeholder="M2025-0289">
        <button>Buscar</button>
      </form>
    </section>

    ${resultado}
  `));
  const PORT = process.env.PORT || 3000;

}).listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});