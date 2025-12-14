

const API_TOKEN = "06e70df0-aaf1-11ee-bae2-a37a2451cc56";
const TEAM_ID = "s9vR3WrdvHijnidTJ";
const DB_ID = "ykya5csft4b4";

async function listarTablas() {
  const res = await fetch(
    `https://api.ninox.com/v1/teams/${TEAM_ID}/databases/${DB_ID}/tables`,
    {
      headers: {
        Authorization: `Bearer ${API_TOKEN}`
      }
    }
  );

  const data = await res.json();

  data.forEach(t => {
    console.log(`ID: ${t.id} | Nombre: ${t.name}`);
  });
}

listarTablas();