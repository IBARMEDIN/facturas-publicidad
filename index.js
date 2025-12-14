const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/* ================= CONFIG ================= */

const PORT = process.env.PORT || 3000;
const MODO_PRUEBA = false; // true = no escribe en Ninox

// ⚠️ USUARIOS (luego se hashéan)
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

// ⏱️ Sesiones
const SESIONES = {};
const TIEMPO_EXPIRACION_MS = 60 * 1000; // 1 minuto

// ===== NINOX =====
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

function crearSesion(usuario) {
  const id = crypto.randomBytes(16).toString("hex");
  SESIONES[id] = {
    usuario,
    lastAccess: Date.now()
  };
  return id;
}

function obtenerUsuarioDesdeCookie(req) {
  const cookie = req.headers.cookie;
  if (!cookie) return null;

  const match = cookie.match(/session=([a-z0-9]+)/);
  if (!match) return null;

  const sesion = SESIONES[match[1]];
  if (!sesion) return null;

  if (Date.now() - sesion.lastAccess > TIEMPO_EXPIRACION_MS) {
    delete SESIONES[match[1]];
    return null;
  }

  sesion.lastAccess = Date.now();
  return sesion.usuario;
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

  /* ===== LOGOUT ===== */
  if (url.pathname === "/logout") {
    const cookie = req.headers.cookie;
    if (cookie) {
      const m = cookie.match(/session=([a-z0-9]+)/);
      if (m) delete SESIONES[m[1]];
    }

    res.writeHead(302, {
      "Set-Cookie": "session=; Max-Age=0; Path=/",
      Location: "/login"
    });
    res.end();
    return;
  }

  /* ===== LOGIN ===== */
  if (url.pathname === "/login") {
    if (req.method === "POST") {
      let body = "";
      for await (const c of req) body += c;
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

      const sessionId = crearSesion({
        email: user.email,
        nombre: user.nombre,
        rol: user.rol
      });

      res.writeHead(302, {
        "Set-Cookie": `session=${sessionId}; HttpOnly; Path=/`,
        Location: "/"
      });
      res.end();
      return;
    }

    res.end(renderPage(`
      <section class="card">
        <h2>Acceso</h2>
        <form method="POST">
          <label>Email<br><input name="email" required></label><br><br>
          <label>Contraseña<br><input type="password" name="password" required></label><br><br>
          <button>Entrar</button>
        </form>
      </section>
    `));
    return;
  }

  /* ===== PROTECCIÓN ===== */
  const usuarioSesion = obtenerUsuarioDesdeCookie(req);
  if (!usuarioSesion) {
    res.writeHead(302, { Location: "/login" });
    res.end();
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

    if (accion === "previsualizar") {
      res.end(renderPage(`
        <section class="card">
          <h2>Confirmar cobro</h2>
          <p><strong>Factura:</strong> ${numeroFactura}</p>
          <p><strong>Fecha:</strong> ${fechaES(fechaCobro)}</p>
          <p><strong>Banco:</strong> ${banco}</p>
          <p><strong>Importe:</strong> ${importeMovimiento.toFixed(2)} €</p>
          <p><strong>Usuario:</strong> ${usuarioSesion.nombre}</p>

          <form method="POST">
            <input type="hidden" name="accion" value="confirmar">
            <input type="hidden" name="numeroFactura" value="${numeroFactura}">
            <input type="hidden" name="recordId" value="${recordId}">
            <input type="hidden" name="fechaCobro" value="${fechaCobro}">
            <input type="hidden" name="banco" value="${banco}">
            <input type="hidden" name="importeMovimiento" value="${importeMovimiento}">
            <button>✅ Confirmar cobro</button>
            <a href="/">Cancelar</a>
          </form>
        </section>
      `));
      return;
    }

    if (accion === "confirmar") {
      if (!MODO_PRUEBA) {
        await fetch(
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
                "Puesta en cobrado por": usuarioSesion.email
              }
            })
          }
        );
      }

      res.end(renderPage(`
        <section class="card success">
          <h2>✅ Factura cobrada</h2>
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

    if (d?.fields && d.fields.Pagada !== "Pagada") {
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
    <div style="text-align:right;">
      ${usuarioSesion.nombre} · <a href="/logout">Cerrar sesión</a>
    </div>

    <section class="card">
      <h2>Buscar factura</h2>
      <form method="GET">
        <input name="factura" placeholder="M2025-0289">
        <button>Buscar</button>
      </form>
    </section>

    ${resultado}
  `));
});

server.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});