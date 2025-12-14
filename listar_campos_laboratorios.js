const API_TOKEN = "06e70df0-aaf1-11ee-bae2-a37a2451cc56";
const TEAM_ID = "s9vR3WrdvHijnidTJ";
const DB_ID = "ykya5csft4b4";
const TABLE_ID = "A"; // Laboratorios

async function listarCampos() {
  const res = await fetch(
    `https://api.ninox.com/v1/teams/${TEAM_ID}/databases/${DB_ID}/tables/${TABLE_ID}`,
    {
      headers: {
        Authorization: `Bearer ${API_TOKEN}`
      }
    }
  );

  const data = await res.json();

  console.log("===== CAMPOS DE LABORATORIOS =====");
  data.fields.forEach(f => {
    console.log(`ID: ${f.id} | Nombre: ${f.name} | Tipo: ${f.type}`);
  });
  console.log("=================================");
}

listarCampos();