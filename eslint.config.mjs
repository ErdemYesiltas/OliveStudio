import tseslint from 'typescript-eslint';
import globals from 'globals';
export default tseslint.config({ ignores: ['Games/**','_legacy-prototype/**','**/out/**','**/out-*/**','**/dist/**','release*/**','outputs/**','node_modules/**','**/*.d.ts','spikes/*/node_modules/**','spikes/*/www/**','spikes/*/ios/**','spikes/*/android/**','spikes/*/build/**'] }, ...tseslint.configs.recommended, {
 files:['**/*.{ts,tsx,mjs}'], languageOptions:{globals:{...globals.browser,...globals.node}},
 rules:{'@typescript-eslint/no-explicit-any':'error','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}]}
});
