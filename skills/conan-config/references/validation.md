# Value validation

Validate the complete target value, not only changed fields.

Check:

- Formily field types, required fields, enums, defaults, `x-validator`, and `x-reactions`.
- Component semantics and nested array/object shapes.
- Unchanged legacy fields that the schema may not expose.
- Every path in the structured semantic diff.
- Suspicious `ytk`, `.biz`, or `test` markers when targeting `cn-prod`.

Return a validation report containing `passed`, `errors`, `warnings`, `warningsAccepted`, `environment`, `schemaId`, `updatedTime`, `sourceSha256`, `targetSha256`, and `summary`.

Never mark warnings accepted unless the user explicitly accepts them. Pass the report unchanged to the confirmed write operation.
