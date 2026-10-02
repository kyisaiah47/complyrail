// A starter pack. Replace it with your own.
//
// A pack is data plus small functions. This one takes a short form and one optional supporting
// document, applies one rule, drafts one grounded summary, and renders one PDF. Read the
// ComplyRail README for every field, and examples/dosetrace in the ComplyRail repository for a
// complete product.
import { definePack, validateFields, determination, needsInput } from 'complyrail';

const FIELDS = [
  { name: 'organisation', label: "your organisation's legal name", required: true, max: 200 },
  { name: 'contact_name', label: 'the name of the person responsible', required: true, max: 120 },
  { name: 'staff', label: 'the number of staff', type: 'integer', required: true, minValue: 0, maxValue: 100000 },
  { name: 'notes', label: 'anything we should know', type: 'textarea', max: 2000 },
  { name: 'supporting', label: 'a supporting document', type: 'file', slot: 'supporting' },
];

const RECORD = `# Record of answers

**{{organisation}}**

Prepared {{today}} for {{contact_name}}.

## Determination

> {{determination}}

## What you told us

| Question | Answer |
|---|---|
| Organisation | {{organisation}} |
| Person responsible | {{contact_name}} |
| Staff | {{staff}} |
| Supporting document | {{document_line}} |

{{summary_block}}
`;

export default definePack({
  id: '__APP_SLUG__',
  product: { name: '__APP_NAME__' },
  prices: [{ id: 'standard', name: '__APP_NAME__', amount: 1900, mode: 'payment' }],

  matches: (session) => (session.metadata?.product === '__APP_SLUG__' ? { id: 'standard', name: '__APP_NAME__', amount: 1900, mode: 'payment' } : null),

  intake: { fields: FIELDS, validate: (form, ctx) => validateFields(FIELDS, form, ctx) },

  documents: [
    {
      slot: 'supporting',
      schema: { about: 'a supporting document', fields: { title: 'string', issuer: 'string', date: 'date' } },
      mime: ['application/pdf', 'image/png', 'image/jpeg'],
      minConfidence: 0.6,
      privacy: 'full',
      validate: () => [],
    },
  ],

  determine(ctx) {
    const staff = Number(ctx.intake.staff);
    if (!Number.isFinite(staff)) return needsInput('Enter the number of staff as a whole number.');
    const size = staff <= 25 ? 'small' : 'large';
    return determination({ summary: `${ctx.intake.organisation} is a ${size} organisation with ${staff} staff.`, size, staff });
  },

  narratives: [
    {
      slot: 'summary',
      system: 'Write two plain sentences for the person responsible, in the second person.',
      facts: (ctx) => ({
        Organisation: ctx.intake.organisation,
        'Person responsible': ctx.intake.contact_name,
        Staff: ctx.intake.staff,
        Determination: ctx.determination.summary,
        'Supporting document': ctx.documents.supporting?.[0]?.value?.title || 'none uploaded',
      }),
      vocabulary: [],
      fallback: 'omit',
    },
  ],

  render(ctx) {
    const doc = ctx.documents.supporting?.[0];
    return [
      {
        name: 'record',
        title: `Record of answers, ${ctx.intake.organisation}`,
        format: 'pdf',
        template: RECORD,
        fields: {
          organisation: ctx.intake.organisation,
          contact_name: ctx.intake.contact_name,
          staff: ctx.intake.staff,
          today: ctx.today,
          determination: ctx.determination.summary,
          document_line: doc ? `${doc.name}${doc.value.title ? `, read as "${doc.value.title}"` : ''}` : 'None uploaded',
          summary_block: ctx.drafts.summary ? `## Summary\n\n${ctx.drafts.summary}` : '',
        },
      },
    ];
  },

  checks: (files) => files.filter((f) => f.format === 'pdf' && f.bytes.subarray(0, 5).toString() !== '%PDF-').map((f) => `${f.name} is not a PDF`),

  mail: {
    from: process.env.MAIL_FROM || '__APP_NAME__ <orders@example.com>',
    intake: 'Subject: Fill in the form for your order\n\nHi {{first_name}},\n\nYour payment went through. Open your order page and fill in the form:\n\n{{order_url}}\n\nYour documents are made as soon as you send it.\n',
    delivery: 'Subject: Your documents are ready\n\nHi {{first_name}},\n\nYour documents are attached and on your order page:\n\n{{order_url}}\n\n{{file_list}}\n',
    reminderDays: 3,
  },
});
