const http = require("http");
const fs = require("fs");
const path = require("path");

const USUARIO_ACTUAL = "antonio@farmavazquez.com";

const MODO_PRUEBA = false; // ⚠️ true = NO escribe en Ninox | false = escribe de verdad

// ===== CONFIGURACIÓN NINOX =====
const API_TOKEN = "06e70df0-aaf1-11ee-bae2-a37a2451cc56";
const TEAM_ID = "s9vR3WrdvHijnidTJ";
const DB_ID = "ykya5csft4b4";
const TABLE_ID = "ZD"; // Facturas Publicidad

function nowISO() {
  return new Date().toISOString();
}

function renderPage(content) {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  return html.replace("{{CONTENT}}", content);
}
function fechaES(fechaISO) {
  if (!fechaISO) return "—";
  const [y, m, d] = fechaISO.split("-");
  return `${d}-${m}-${y}`;
}

async function obtenerNombreLaboratorio(labId) {
  if (!labId) return null;

  const res = await fetch(
    `https://api.ninox.com/v1/teams/${TEAM_ID}/databases/${DB_ID}/tables/A/records/${labId}?style=names`,
    { headers: { Authorization: `Bearer ${API_TOKEN}` } }
  );

  if (!res.ok) return null;
  const data = await res.json();
  return data.fields?.Nombre_del_laboratorio || null;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  /* ===== CSS ===== */
  if (url.pathname === "/styles.css") {
    res.writeHead(200, { "Content-Type": "text/css" });
    res.end(fs.readFileSync(path.join(__dirname, "styles.css")));
    return;
  }

  /* ===== POST: REGISTRO / CONFIRMACIÓN ===== */
  if (req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk.toString());
    req.on("end", () => {
      const params = new URLSearchParams(body);

      const accion = params.get("accion");
  
      const numeroFactura = params.get("numeroFactura");
      const recordId = params.get("recordId");
      const fechaCobro = params.get("fechaCobro");
      const bancoSel = params.get("banco");
      const otroBanco = params.get("otroBanco");
      const bancoFinal = bancoSel === "OTRO" ? otroBanco : bancoSel;
  
      const importeRaw = (params.get("importeMovimiento") || "").replace(",", ".");
      const importeMovimiento = Number(importeRaw);
  
      const usuario = params.get("usuario");

      if (!recordId) {
        res.end(renderPage(`
          <section class="card">
            <strong>Error interno: ID de factura no recibido</strong>
            <div class="actions">
              <a href="/"><button class="secondary">Volver</button></a>
            </div>
          </section>
        `));
        return;
      }
  
      if (!Number.isFinite(importeMovimiento) || importeMovimiento <= 0) {
        res.end(renderPage(`
          <section class="card">
            <strong>❌ Importe inválido</strong>
            <div class="actions">
              <a href="/"><button class="secondary">Volver</button></a>
            </div>
          </section>
        `));
        return;
      }

      if (accion === "previsualizar") {
        res.end(renderPage(`
          <section class="card">
            <h2>Confirmar cobro</h2>
      
            <p><strong>Factura:</strong> ${numeroFactura}</p>
            <p><strong>Fecha de cobro:</strong> ${fechaES(fechaCobro)}</p>
            <p><strong>Banco:</strong> ${bancoFinal}</p>
            <p><strong>Importe del movimiento:</strong> ${importeMovimiento.toFixed(2)} €</p>
            <p><strong>Puesta en cobrado por:</strong> ${usuario}</p>
      
            <hr>
      
            <form method="POST">
              <input type="hidden" name="accion" value="confirmar">
              <input type="hidden" name="numeroFactura" value="${numeroFactura}">
              <input type="hidden" name="recordId" value="${recordId}">
              <input type="hidden" name="fechaCobro" value="${fechaCobro}">
              <input type="hidden" name="banco" value="${bancoFinal}">
              <input type="hidden" name="importeMovimiento" value="${importeMovimiento}">
              <input type="hidden" name="usuario" value="${usuario}">
      
              <button type="submit">✅ Confirmar cobro</button>
              <a href="/"><button type="button" class="secondary">Cancelar</button></a>
            </form>
          </section>
        `));
        return;
      }
      if (accion === "confirmar") {
      if (MODO_PRUEBA) {
        const payloadSimulado = {
          Pagada: "Pagada",
          "Fecha de cobro": fechaCobro,
          "Fecha + hora de cobro": nowISO(),
          Banco: bancoFinal,
          "Importe del movimiento": importeMovimiento,
          "Puesta en cobrado por": usuario
        };
      
        res.end(renderPage(`
          <section class="card">
            <h2>Simulación de cobro (MODO PRUEBA)</h2>
  
            <p><strong>Factura:</strong> ${numeroFactura}</p>
  
            <p style="color:#b45309">
              ⚠️ MODO PRUEBA ACTIVO<br>
              No se ha escrito nada en Ninox.
            </p>
  
            <h3>Datos que se enviarían a Ninox</h3>
  
            <pre style="background:#f9fafb;padding:16px;border-radius:6px;overflow:auto;">
  ${JSON.stringify(payloadSimulado, null, 2)}
            </pre>
  
            <div class="actions">
              <a href="/"><button class="secondary">Volver</button></a>
            </div>
          </section>
        `));
  
        return;
      }
    }
  
      // ===== PUT REAL A NINOX (SOLO CAMPO PAGADA) =====
(async () => {
  try {
    const resPut = await fetch(
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
            Banco: bancoFinal,
            "Importe del movimiento": importeMovimiento,
            "Puesta en cobrado por": usuario
          }
        })
      }
    );

    if (!resPut.ok) {
      const errText = await resPut.text();
      res.end(renderPage(`
        <section class="card">
          <h2>Error al guardar</h2>
          <pre>${errText}</pre>
          <a href="/"><button class="secondary">Volver</button></a>
        </section>
      `));
      return;
    }

    res.end(renderPage(`
      <section class="card">
        <h2>✅ Factura marcada como pagada</h2>
        <p><strong>Factura:</strong> ${numeroFactura}</p>

        <p style="color:green">
          El campo <strong>Pagada</strong> se ha actualizado correctamente.
        </p>

        <a href="/"><button class="secondary">Volver</button></a>
      </section>
    `));
  } catch (err) {
    res.end(renderPage(`
      <section class="card">
        <h2>Error inesperado</h2>
        <pre>${err.message}</pre>
        <a href="/"><button class="secondary">Volver</button></a>
      </section>
    `));
  }
})();
    });
  
    return; // 🔴 CORTA AQUÍ EL POST
  }

  /* ===== GET ===== */
   const numeroFactura = url.searchParams.get("factura");

  /* ===== FORMULARIO INICIAL ===== */
  if (!numeroFactura) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderPage(`
      <section class="card">
        <h2>Buscar factura</h2>
        <form method="GET">
          <input type="text" name="factura" placeholder="Ej: M2025-0289" required>
          <div class="actions">
            <button type="submit">Buscar factura</button>
          </div>
        </form>
      </section>
    `));
    return;
  }

  /* ===== BUSCAR FACTURA EN NINOX ===== */
  const response = await fetch(
    `https://api.ninox.com/v1/teams/${TEAM_ID}/databases/${DB_ID}/tables/${TABLE_ID}/record`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        filters: { M1: numeroFactura }
      })
    }
  );

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    res.end(renderPage(`
      <section class="card">
        <strong>Error en respuesta de Ninox</strong>
        <pre>${text}</pre>
      </section>
    `));
    return;
  }

  if (!data || !data.fields) {
    res.end(renderPage(`
      <section class="card">
        <strong>❌ Factura ${numeroFactura} NO encontrada</strong>
        <div class="actions">
          <a href="/"><button class="secondary">Buscar otra factura</button></a>
        </div>
      </section>
    `));
    return;
  }

  const f = data.fields;

  if (f.Pagada === "Pagada") {
    res.end(renderPage(`
      <section class="card">
        <strong>⚠️ La factura ${numeroFactura} ya está pagada</strong>
        <div class="actions">
          <a href="/"><button class="secondary">Buscar otra factura</button></a>
        </div>
      </section>
    `));
    return;
  }

  const nombreLaboratorio = await obtenerNombreLaboratorio(f.Laboratorios);
  const importe = Number(f["Importe total fijo"]);
  const importeFormateado = Number.isFinite(importe) ? importe.toFixed(2) : "—";

  /* ===== FACTURA NO PAGADA ===== */
  res.end(renderPage(`
    <section class="card">
      <h2>Factura encontrada (NO pagada)</h2>

      <p><strong>Número:</strong> ${f["Número de factura"]}</p>
      <p><strong>Laboratorio:</strong> ${nombreLaboratorio ?? "—"}</p>
      <p><strong>Importe total factura:</strong> ${importeFormateado} €</p>

      <hr>

      <h3>Registrar cobro</h3>

      <form method="POST">
        <input type="hidden" name="accion" value="previsualizar">
        <input type="hidden" name="numeroFactura" value="${f["Número de factura"]}">
        <input type="hidden" name="recordId" value="${data.id}">

        <p>
          <strong>Fecha y hora de cobro:</strong><br>
          <input
            type="text"
            value="${new Date().toLocaleDateString("es-ES")} ${new Date().toLocaleTimeString("es-ES", { hour: '2-digit', minute: '2-digit' })}"
            disabled>
        </p>

        <p>
          <label>
            Fecha de cobro:<br>
            <input type="date" name="fechaCobro"
              value="${new Date().toISOString().slice(0,10)}" required>
          </label>
        </p>

        <p>
          <label>
            Banco:<br>
            <select name="banco" id="banco" onchange="toggleOtroBanco()" required>
              <option value="BANCOFAR" selected>Bancofar</option>
              <option value="IBERCAJA">Ibercaja</option>
              <option value="OTRO">Otro</option>
            </select>
          </label>
        </p>

        <div id="otroBancoContainer" style="display:none;">
          <label>
            Indica el banco:<br>
            <input type="text" name="otroBanco">
          </label>
        </div>

        <p>
          <label>
            Importe del movimiento (€):<br>
            <input type="text" name="importeMovimiento"
              placeholder="${importeFormateado}" required>
          </label>
        </p>

        <p>
          <label>
            Puesta en cobrado por:<br>
            <input type="text" value="${USUARIO_ACTUAL}" disabled>
          </label>
          <input type="hidden" name="usuario" value="${USUARIO_ACTUAL}">
        </p>

        <button type="submit">💾 Registrar cobro</button>
      </form>

      <script>
        function toggleOtroBanco() {
          const banco = document.getElementById("banco").value;
          document.getElementById("otroBancoContainer").style.display =
            banco === "OTRO" ? "block" : "none";
        }
      </script>

      <div class="actions">
        <a href="/"><button class="secondary">Buscar otra factura</button></a>
      </div>
    </section>
  `));
}).listen(3000, () => {
  console.log("Servidor activo en http://localhost:3000");
});