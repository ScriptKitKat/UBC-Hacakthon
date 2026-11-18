export const noComments = {
  meta: {
    type: "problem",
    schema: [],
    messages: { forbidden: "Code comments are not allowed; express intent through names and structure." },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === "Shebang") continue;
          context.report({ loc: comment.loc, messageId: "forbidden" });
        }
      },
    };
  },
};
