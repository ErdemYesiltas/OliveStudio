/** Await inside a function does not keep the importing ES module in async evaluation. */
export function hasModuleAwait(node){
 if(!node||typeof node!=='object')return false;
 if(Array.isArray(node))return node.some(hasModuleAwait);
 if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type))return false;
 if(node.type==='AwaitExpression'||node.type==='ForOfStatement'&&node.await)return true;
 return Object.values(node).some(hasModuleAwait);
}
