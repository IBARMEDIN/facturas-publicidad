const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

/* ================= CONFIG ================= */

const PORT = process.env.PORT || 3000;
const MODO_PRUEBA = false;

/* ===== USUARIOS ===== */

const USERS_FILE = path.join(__dirname, "usuarios.json");

function cargarUsuarios() {
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]");
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

function guardarUsuarios(u) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2));
}

/* ===== SESIONES ===== */

const SESIONES = {};
const TIEMPO_EXPIRACION_MS = 60 * 1000;

/* ===== NINOX ===== */

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

function crearSesion(data) {
  const id = crypto.randomBytes(16).toString("hex");
  SESIONES[id] = { ...data, lastAccess: Date.now() };
  return id;
}

function obtenerSesion(req) {
  const c = req.headers.cookie;
  if (!c) return null;
  const m = c.match(/session=([a-z0-9]+)/);
  if (!m) return null;
  const s = SESIONES[m[1]];
  if (!s) return null;
  if (Date.now() - s.lastAccess > TIEMPO_EXPIRACION_MS) {
    delete SESIONES[m[1]];
    return null;
  }
  s.lastAccess = Date.now();
  return s;
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

  /* ===== LOGIN ===== */

  if (url.pathname === "/login") {
    if (req.method === "POST") {
      let body = "";
      for await (const c of req) body += c;
      const p = new URLSearchParams(body);

      const usuarios = cargarUsuarios();
      const user = usuarios.find(u => u.usuario === p.get("usuario"));

      if (!user) {
        res.end(renderPage(`<p>Usuario incorrecto</p><a href="/login">Volver</a>`));
        return;
      }

      if (user.passwordHash === null) {
        const sid = crearSesion({ usuario: user.usuario, crearPassword: true });
        res.writeHead(302, {
          "Set-Cookie": `session=${sid}; Path=/; HttpOnly`,
          Location: "/crear-password"
        });
        res.end();
        return;
      }

      const ok = await bcrypt.compare(p.get("password"), user.passwordHash);
      if (!ok) {
        res.end(renderPage(`<p>Contraseña incorrecta</p><a href="/login">Volver</a>`));
        return;
      }

      const sid = crearSesion({ usuario: user.usuario });
      res.writeHead(302, {
        "Set-Cookie": `session=${sid}; Path=/; HttpOnly`,
        Location: "/"
      });
      res.end();
      return;
    }

    res.end(renderPage(`
      <section class="card login-card">
        <h2>Acceso al sistema</h2>
        <p class="login-subtitle">Cobro de facturas de publicidad</p>
    
        <form method="POST" autocomplete="off">
          <div class="field">
            <label>Usuario</label>
            <input
              type="text"
              name="usuario"
              autocomplete="username"
              required
            >
          </div>
    
          <div class="field">
            <label>Contraseña</label>
            <input
              type="password"
              name="password"
              autocomplete="new-password"
              required
            >
          </div>
    
          <div class="form-actions login-actions">
            <button type="submit" class="login-button">Entrar</button>
          </div>
        </form>
      </section>
    `));
    return;   
  }           

  /* ===== CREAR PASSWORD ===== */

  if (url.pathname === "/crear-password") {
    const sesion = obtenerSesion(req);
    if (!sesion || !sesion.crearPassword) {
      res.writeHead(302, { Location: "/login" });
      res.end();
      return;
    }

    if (req.method === "POST") {
      let body = "";
      for await (const c of req) body += c;
      const p = new URLSearchParams(body);

      if (p.get("p1") !== p.get("p2")) {
        res.end(renderPage(`<p>No coinciden</p><a href="/crear-password">Volver</a>`));
        return;
      }

      const usuarios = cargarUsuarios();
      const u = usuarios.find(x => x.usuario === sesion.usuario);
      u.passwordHash = await bcrypt.hash(p.get("p1"), 10);
      guardarUsuarios(usuarios);

      const sid = crearSesion({ usuario: u.usuario });
      res.writeHead(302, {
        "Set-Cookie": `session=${sid}; Path=/; HttpOnly`,
        Location: "/"
      });
      res.end();
      return;
    }

    res.end(renderPage(`
      <section class="card search-card">
        <h2>Crear contraseña</h2>
        <form method="POST">
          <input type="password" name="p1" placeholder="Contraseña" required><br><br>
          <input type="password" name="p2" placeholder="Repetir" required><br><br>
          <button>Guardar</button>
        </form>
      </section>
    `));
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
  /* ===== PROTECCIÓN ===== */

  const sesion = obtenerSesion(req);
  if (!sesion) {
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

    /* === PREVISUALIZAR === */
    if (accion === "previsualizar") {
      res.end(renderPage(`
        <section class="card search-card">
          <h2>Confirmar cobro</h2>

          <p><strong>Factura:</strong> ${p.get("numeroFactura")}</p>
          <p><strong>Fecha:</strong> ${fechaES(p.get("fechaCobro"))}</p>
          <p><strong>Banco:</strong> ${p.get("banco")}</p>
          <p><strong>Importe:</strong> ${Number(p.get("importeMovimiento")).toFixed(2)} €</p>
          <p><strong>Usuario:</strong> ${sesion.usuario}</p>

          <form method="POST">
            <input type="hidden" name="accion" value="confirmar">
            <input type="hidden" name="recordId" value="${p.get("recordId")}">
            <input type="hidden" name="numeroFactura" value="${p.get("numeroFactura")}">
            <input type="hidden" name="fechaCobro" value="${p.get("fechaCobro")}">
            <input type="hidden" name="banco" value="${p.get("banco")}">
            <input type="hidden" name="importeMovimiento" value="${p.get("importeMovimiento")}">

            <div class="form-actions">
            <button>✅ Confirmar cobro</button>
            <a href="/" class="button secondary">Cancelar</a>
            </div>
          </form>
        </section>
      `));
      return;
    }

    /* === CONFIRMAR === */
    if (accion === "confirmar" && !MODO_PRUEBA) {
      await fetch(
        `https://api.ninox.com/v1/teams/${TEAM_ID}/databases/${DB_ID}/tables/${TABLE_ID}/records/${p.get("recordId")}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${API_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            fields: {
              Pagada: "Pagada",
              "Fecha de cobro": p.get("fechaCobro"),
              "Fecha + hora de cobro": nowISO(),
              Banco: p.get("banco"),
              "Importe del movimiento": Number(p.get("importeMovimiento")),
              "Puesta en cobrado por": sesion.usuario
            }
          })
        }
      );

      res.end(renderPage(`
        <section class="card search-card success">
          <h2>✅ Factura cobrada correctamente</h2>
          <a href="/" class="button">← Volver</a>
        </section>
      `));
      return;
    }
  }

  /* ================= GET ================= */

  let resultado = "";
  let numeroFactura = url.searchParams.get("factura");
    if (numeroFactura) {
      numeroFactura = numeroFactura.toUpperCase();
    }

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

    if (!d || !d.fields) {
      resultado = `<section class="card search-card error">❌ La factura no existe<br><a href="/" class="button secondary">← Volver</a></section>`;
    } else if (d.fields.Pagada === "Pagada") {
      resultado = `<section class="card search-card warning">⚠️ La factura ya está pagada<br><a href="/" class="button secondary">← Volver</a></section>`;
    } else {
      const lab = await obtenerNombreLaboratorio(d.fields.Laboratorios);
      const imp = Number(d.fields["Importe total fijo"]).toFixed(2);

      resultado = `
        <section class="card search-card">
          <h2>Factura ${numeroFactura}</h2>
          <p><b>Laboratorio:</b> ${lab}</p>
          <p><b>Importe:</b> ${imp} €</p>

          <form method="POST">
            <input type="hidden" name="accion" value="previsualizar">
            <input type="hidden" name="recordId" value="${d.id}">
            <input type="hidden" name="numeroFactura" value="${numeroFactura}">

            <div class="field">
            <label>Fecha de cobro</label>
            <input type="date" name="fechaCobro" value="${nowISO().slice(0,10)}">
            </div>

            <div class="field">
            <label>Banco</label>
            <select name="banco">
            <option>BANCOFAR</option>
            <option>IBERCAJA</option>
            </select>
            </div>

            <div class="field">
            <label>Importe del cobro (€)</label>
            <input name="importeMovimiento" value="${imp}">
            </div>

            <div class="form-actions">
            <button type="submit">Registrar cobro</button>
            <a href="/" class="button secondary">← Volver</a>
            </div>
          </form>
        </section>
      `;
    }
  }

  res.end(renderPage(`
    <div class="top-user">
  ${sesion.usuario} · <a href="/logout" class="secondary">Salir</a>
</div>
    ${resultado || `
      <section class="card search-card">
        <h2>Buscar factura</h2>
        <form autocomplete="off">
          <input
            name="factura"
            autocomplete="off"
            required
          >
          <button>Buscar</button>
        </form>
      </section>
    `}
  `));
});

/* ===== LISTEN ===== */

server.listen(PORT, () => {
  console.log("Servidor activo en puerto", PORT);
});