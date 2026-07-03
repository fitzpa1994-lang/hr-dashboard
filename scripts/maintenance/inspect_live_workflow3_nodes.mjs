import process from 'node:process';

const workflowId = process.argv[2] || 'zEIwksk6hz9Ri8NA';

const n8nBaseUrl = String(process.env.N8N_API_BASE_URL || process.env.N8N_API_URL || '').trim().replace(/\/+$/, '');
const n8nApiKey = String(process.env.N8N_API_KEY || '').trim();

if (!n8nBaseUrl || !n8nApiKey) {
  console.error('Missing N8N_API_BASE_URL or N8N_API_KEY');
  process.exit(1);
}

async function main() {
  const response = await fetch(`${n8nBaseUrl}/workflows/${workflowId}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': n8nApiKey,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET workflow failed: status=${response.status}; body=${text.slice(0, 300)}`);
  }
  const workflow = JSON.parse(text);
  const summary = (workflow.nodes || []).map((node) => ({
    id: node.id,
    name: node.name,
    type: node.type,
    position: node.position,
    foldersToInclude: node.parameters?.filters?.foldersToInclude || null,
    ifConditions: node.parameters?.conditions?.conditions?.map((condition) => ({
      leftValue: condition.leftValue,
      rightValue: condition.rightValue,
      operation: condition.operator?.operation || null,
    })) || null,
  }));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
