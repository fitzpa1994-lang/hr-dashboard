import fs from 'node:fs';

const [targetPath] = process.argv.slice(2);

if (!targetPath) {
  console.error('Usage: node scripts/patch_workflow3_resignation_fallback.mjs <workflow-json>');
  process.exit(1);
}

const raw = fs.readFileSync(targetPath, 'utf8');
const workflow = JSON.parse(raw);

const nodes = workflow.nodes ?? [];
const connections = workflow.connections ?? {};

const onboardingTrigger = nodes.find((node) =>
  (node?.parameters?.filters?.foldersToInclude ?? []).some((folderId) => typeof folderId === 'string' && folderId.includes('AQCddaHEqpeLSJK4gY8M9T9S')),
);

const resignationTrigger = nodes.find((node) =>
  (node?.parameters?.filters?.foldersToInclude ?? []).some((folderId) => typeof folderId === 'string' && folderId.includes('AQDrOyTdalCqR4oTn0wwCObdAEg2qZyL')),
);

const onboardingIfNodeName = connections[onboardingTrigger?.name]?.main?.[0]?.[0]?.node;
const resignationCodeNodeName = connections[resignationTrigger?.name]?.main?.[0]?.[0]?.node;

const onboardingIfNode = nodes.find((node) => node.name === onboardingIfNodeName);
const resignationCodeNode = nodes.find((node) => node.name === resignationCodeNodeName);

if (!onboardingIfNode) {
  throw new Error('Could not find onboarding IF node.');
}

if (!resignationCodeNode) {
  throw new Error('Could not find resignation code node.');
}

const branch = (connections[onboardingIfNode.name] ??= { main: [] });
branch.main ??= [];
branch.main[0] ??= [];
branch.main[1] = [
  {
    node: resignationCodeNode.name,
    type: 'main',
    index: 0,
  },
];

connections[resignationTrigger.name] = {
  main: [[{ node: onboardingIfNode.name, type: 'main', index: 0 }]],
};

fs.writeFileSync(targetPath, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify(
    {
      targetPath,
      onboardingIfNode: onboardingIfNode.name,
      resignationCodeNode: resignationCodeNode.name,
      resignationTrigger: resignationTrigger.name,
      resignationTriggerTarget: connections[resignationTrigger.name].main[0][0],
      falseBranchTargets: branch.main[1],
    },
    null,
    2,
  ),
);
