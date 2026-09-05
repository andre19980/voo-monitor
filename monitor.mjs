// Monitor de preços de voos SP <-> Rio (fev/2027)
// Lê alertas de preço NÃO LIDOS do Gmail e atualiza o database no Notion.
// Roda no GitHub Actions (Node >= 18, fetch nativo). Sem dependências externas.
// Autenticação: user API key + org + project (mesmos headers que a CLI composio usa).

const API = process.env.COMPOSIO_API_URL;
const API_KEY = process.env.COMPOSIO_API_KEY;

const ORG_ID = process.env.COMPOSIO_ORG_ID;
const PROJECT_ID = process.env.COMPOSIO_PROJECT_ID;
const USER_ID = process.env.COMPOSIO_USER_ID;

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

// site (chave interna) -> id da linha (page) no database
const ROW_IDS = {
  "kayak":          "3d229ba7-f19d-80a1-9c95-ea2ea01438a1",
  "skyscanner":     "3d229ba7-f19d-8069-841a-eab3fe4b02d7",
  "google flights": "3d229ba7-f19d-80fc-a0b1-f014ac8e8567",
};

// site -> nomes exatos das propriedades por trecho
const COLS = {
  "kayak": {
    ida: "Ida (05/02/2027)",
    volta: "Volta (10/02/2027)",
    idaVolta: "Ida e Volta (05/02/2027 - 10/02/2027)",
  },
  "skyscanner": {
    ida: "Ida (05/02/2027)",
    volta: "Volta (10/02/2027)",
    idaVolta: "Ida e Volta (05/02/2027 - 10/02/2027)",
  },
  "google flights": {
    ida: "Ida (05/02/2027)",
    volta: "Volta (10/02/2027)",
    idaVolta: "Ida e Volta (05/02/2027 - 10/02/2027)",
  },
};

// AJUSTAR conforme os emails reais dos alertas (domínios dos remetentes)
const SENDER_MAP = [
  { site: "kayak", match: (s) => /kayak/i.test(s) },
  { site: "skyscanner", match: (s) => /skyscanner/i.test(s) },
  { site: "google flights", match: (s) => /google/i.test(s) || /flights/i.test(s) },
];

async function runTool(slug, args) {
  const res = await fetch(`${API}/${slug}`, {
    method: "POST",
    headers: {
      "x-user-api-key": API_KEY,
      "x-org-id": ORG_ID,
      "x-project-id": PROJECT_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ arguments: args, user_id: USER_ID }),
  });
  const json = await res.json();
  if (!json.successful) throw new Error(`${slug}: ${json.error?.message || json.error || JSON.stringify(json)}`);
  return json.data;
}

function detectSite(sender) {
  if (!sender) return null;
  for (const e of SENDER_MAP) if (e.match(sender)) return e.site;
  return null;
}

function detectLeg(subject, body) {
  const txt = `${subject || ""} ${body || ""}`.toLowerCase();
  if (/\bida e volta\b|\bround[-\s]?trip\b/.test(txt)) return "idaVolta";
  if (/\bida\b|outbound/.test(txt)) return "ida";
  if (/\bvolta\b|inbound/.test(txt)) return "volta";
  return null;
}

function extractPrice(body) {
  const m = (body || "").match(/R\$\s?([0-9][0-9.,]*)/);
  return m ? `R$ ${m[1]}` : null;
}

function parseAlert(msg) {
  const sender = msg.sender || "";
  const site = detectSite(sender);
  if (!site) return null;
  const leg = detectLeg(msg.subject, msg.messageText);
  const price = extractPrice(msg.messageText);
  if (!leg || !price) {
    console.log(`[skip] site=${site} leg=${leg} price=${price} msg=${msg.messageId}`);
    return null;
  }
  return { site, leg, price, messageId: msg.messageId };
}

async function fetchRows() {
  const data = await runTool("NOTION_QUERY_DATABASE_WITH_FILTER", {
    database_id: DATABASE_ID,
    page_size: 100,
  });
  const rows = {};
  for (const r of data.results || []) {
    const title = (r.properties?.Site?.title?.[0]?.plain_text || "").toLowerCase();
    rows[title] = { id: r.id, props: r.properties || {} };
  }
  return rows;
}

function currentValue(row, col) {
  const p = row.props[col];
  if (!p) return "";
  return (p.rich_text || []).map((t) => t.plain_text).join("");
}

async function updateCell(rowId, colName, value) {
  await runTool("NOTION_UPDATE_ROW_DATABASE", {
    row_id: rowId,
    properties: [{ name: colName, type: "rich_text", value }],
  });
  console.log(`[update] ${colName} <- ${value}`);
}

async function main() {
  if (!API_KEY) throw new Error("COMPOSIO_API_KEY não definida");

  const data = await runTool("GMAIL_FETCH_EMAILS", {
    query: "is:unread",
    max_results: 50,
    verbose: true,
  });
  const messages = data.messages || [];
  console.log(`Emails não lidos: ${messages.length}`);

  const rows = await fetchRows();
  const processed = [];

  for (const msg of messages) {
    const p = parseAlert(msg);
    if (!p) continue;

    const rowId = ROW_IDS[p.site];
    const row = rows[p.site];
    if (!rowId || !row) {
      console.log(`[warn] linha não encontrada para ${p.site}`);
      processed.push(msg.messageId);
      continue;
    }

    const col = COLS[p.site][p.leg];
    const prev = currentValue(row, col);

    if (prev !== p.price) {
      await updateCell(rowId, col, p.price);
    } else {
      console.log(`[igual] ${p.site} ${p.leg} já está ${p.price}`);
    }
    processed.push(msg.messageId);
  }

  if (processed.length) {
    await runTool("GMAIL_BATCH_MODIFY_MESSAGES", {
      messageIds: processed,
      removeLabelIds: ["UNREAD"],
    });
    console.log(`Marcados como lidos: ${processed.length}`);
  }
  console.log("Fim.");
}

main().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
