const http = require("http");
const fs = require("fs");
const path = require("path");

/* ================= CONFIG ================= */

const PORT = process.env.PORT || 3000;
const MODO_PRUEBA = false; // true = NO escribe en Ninox

// --- Ninox ---
const API_TOKEN = "06e70df0-aaf1-11ee-bae2-a37a2451cc56";
const TEAM_ID = "s9vR3WrdvHijnidTJ";
const DB_ID = "ykya5csft4b4";
const TABLE_ID = "ZD";

// --- Usuarios (login simple) ---
const USUARIOS = [
  {
    email: "antonio@farmavazquez.com",
    password: "1234",
    nombre: "Antonio",
    rol: "admin"
  },
  {
    email: "virginia.peirat@farmavazquez.com",
    password: "abcd",
    nombre: "Virginia",
    rol: "usuario"
  }
];

// --- Sesiones en memoria ---
const SESIONES = {};

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

function obtenerUsuarioDesdeCookie(req) {
  const cookie = req.headers.cookie;
  if (!cookie) return null;

  const match = cookie.match(/session=([a-zA-Z0-9]+)/);
  if (!match) return null;

  return SESIONES[match[1]] || null;
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  /* ===== CSS ===== */
  if (url.pathname === "/styles.css") {
    res.writeHead(200, { "Content-Type": "text/css" });
    res.end(fs.readFileSync(path.join(__dirname, "styles.css")));
    return;
  }

  /* ================= LOGIN ================= */

  // --- GET /login ---
  if (req.method === "GET" && url.pathname === "/login") {
    res.end(renderPage(`
      <section class="card">
        <h2>Acceso al ERP</h2>

        <form method="POST" action="/login">
          <label>Email<br>
            <input type="email" name="email" required>
          </label><br><br>

          <label>Contraseña<br>
            <input type="password" name="password" required>
          </label><br><br>

          <button>Entrar</button>
        </form>
      </section>
    `));
    return;
  }

  // --- POST /login ---
  if (req.method === "POST" && url.pathname === "/login") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const p = new URLSearchParams(body);

    const email = p.get("email");
    const password = p.get("password");

    const user = USUARIOS.find(
      u => u.email === email && u.password === password
    );

    if (!user) {
      res.end(renderPage(`<p>Credenciales incorrectas</p><a href="/login">Volver</a>`));
      return;
    }

    const sessionId = Math.random().toString(36).slice(2);
    SESIONES[sessionId] = {
      email: user.email,
      nombre: user.nombre,
      rol: user.rol
    };

    res.writeHead(302, {
      "Set-Cookie": `session=${sessionId}; HttpOnly; Path=/`,
      Location: "/"
    });
    res.end();
    return;
  }

  /* ================= PROTECCIÓN ================= */

  const usuarioSesion = obtenerUsuarioDesdeCookie(req);

  if (!usuarioSesion && url.pathname !== "/login") {
    res.writeHead(302, { Location: "/login" });
    res.end();
    return;
  }

  /* ================= POST ERP ================= */

  if (req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const p = new URLSearchParams(body);

    const accion = p.get("accion");
    const numeroFactura = p.get("numeroFactura");
    const recordId = p.get("recordId");
    const fechaCobro = p.get("fechaCobro");
    const banco = p.get("banco");
    const importeMovimiento = Number(
      (p.get("importeMovimiento") || "").replace(",", ".")
    );

    const usuario = usuarioSesion.email;

    if (!recordId) {
      res.end(renderPage(`<p>Error interno: falta ID</p>`));
      return;
    }

    if (!Number.isFinite(importeMovimiento) || importeMovimiento <= 0) {
      res.end(renderPage(`<p>Importe inválido</p>`));
      return;
    }

    // ===== PREVISUALIZAR =====
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

            <button id="btnConfirmar">✅ Confirmar cobro</button>

            <div id="spinner" style="display:none; margin-top:10px;">
              <span class="loader"></span>
              <span style="margin-left:8px;">Procesando…</span>
            </div>

            <a href="/" style="margin-left:10px;">Cancelar</a>
          </form>

          <script>
            function bloquear() {
              document.getElementById("btnConfirmar").disabled = true;
              document.getElementById("btnConfirmar").innerText = "Confirmando…";
              document.getElementById("spinner").style.display = "flex";
              return true;
            }
          </script>
        </section>
      `));
      return;
    }

    // ===== CONFIRMAR =====
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
        const err = await r.text();
        res.end(renderPage(`<pre>Error al guardar:\n${err}</pre>`));
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

  /* ================= GET ERP ================= */

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

            <label>Fecha de cobro<br>
              <input type="date" name="fechaCobro" value="${nowISO().slice(0,10)}">
            </label><br><br>

            <label>Banco<br>
              <input name="banco" value="BANCOFAR">
            </label><br><br>

            <label>Importe del movimiento (€)<br>
              <input name="importeMovimiento" value="${imp}">
            </label><br><br>

            <button>Registrar cobro</button>
          </form>
        </section>
      `;
    }
  }

  res.end(renderPage(`
    <section class="card">
      <h2>Buscar factura</h2>
      <p>Usuario: <strong>${usuarioSesion.email}</strong></p>
      <form method="GET">
        <input name="factura" placeholder="M2025-0289">
        <button>Buscar</button>
      </form>
    </section>

    ${resultado}
  `));
});

server.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});