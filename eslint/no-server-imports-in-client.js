const SERVER_ONLY_FEATURES = /^@\/features\/(ledger|execution|markets|desk|xbot|storage|history|research|positions)(\/|$)/u;

export const noServerImportsInClient = {
  meta: {
    type: "problem",
    schema: [],
    messages: { forbidden: "Client components must not import server-only feature '{{source}}'." },
  },
  create(context) {
    let isClient = false;
    return {
      Program(node) {
        isClient = node.body.some(
          (statement) => statement.type === "ExpressionStatement" && statement.directive === "use client",
        );
      },
      ImportDeclaration(node) {
        if (isClient && SERVER_ONLY_FEATURES.test(node.source.value)) {
          context.report({ node, messageId: "forbidden", data: { source: node.source.value } });
        }
      },
    };
  },
};
