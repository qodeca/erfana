// Xezar SDLC's additional project merge gate. Hosting policy is independently enforced.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export function projectPolicy(pr) {
  if(!Array.isArray(pr?.labels) || pr.labels.some(l=>typeof l?.name!=='string')) return {unavailable:'PR labels missing or malformed'};
  const labels=new Set(pr.labels.map(l=>l.name));
  for(const label of ['blocked','do-not-merge','qa','qa-failed','design','design-failed']) if(labels.has(label)) return {refused:`SDLC label ${label} blocks merge`};
  if(labels.has('needs-qa') && labels.has('skip-qa'))return {refused:'needs-qa and skip-qa conflict'};
  if(labels.has('needs-qa')&&!labels.has('qa-approved'))return {refused:'needs-qa requires qa-approved backed by reviewer evidence'};
  // The design gate (SDLC.md § The design gate) mirrors the QA gate; neither approval satisfies the other.
  if(labels.has('needs-design') && labels.has('skip-design'))return {refused:'needs-design and skip-design conflict'};
  if(labels.has('needs-design')&&!labels.has('design-approved'))return {refused:'needs-design requires design-approved backed by the "## Design review" evidence'};
  return {passed:true};
}
const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if(isMain){let input='';for await(const chunk of process.stdin)input+=chunk;try{console.log(JSON.stringify(projectPolicy(JSON.parse(input))));}catch{console.log(JSON.stringify({unavailable:'PR response is not valid JSON'}));}}
