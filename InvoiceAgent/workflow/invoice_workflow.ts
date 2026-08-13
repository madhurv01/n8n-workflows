// n8n Workflow SDK source for "InvoiceAgent - Automated Invoice Processing"
// Live version of this workflow: https://hug-multitask-granny.ngrok-free.dev/workflow/8nONwE9xqUK2XmhG
import { workflow, node, trigger, languageModel, newCredential, expr } from '@n8n/workflow-sdk';

const gmailTrigger = trigger({
  type: 'n8n-nodes-base.gmailTrigger',
  version: 1.4,
  config: {
    name: 'Gmail Trigger',
    position: [-1408, 0],
    parameters: {
      pollTimes: { item: [{ mode: 'everyMinute' }] },
      simple: false,
      filters: { q: 'has:attachment filename:pdf newer_than:1d' },
      options: { downloadAttachments: true }
    },
    credentials: { gmailOAuth2: newCredential('Gmail account') }
  },
  output: [{
    id: '18c9f2a1b3d4e5f6',
    subject: 'Invoice #INV-1042 from Acme Corp',
    from: 'billing@acme.com',
    binary: { attachment_0: { fileName: 'invoice.pdf', mimeType: 'application/pdf' } }
  }]
});

const validateAttachments = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate & Filter Attachments',
    position: [-1168, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const output = [];\n" +
        "const invoiceHints = /invoice|receipt|bill|statement/i;\n\n" +
        "for (const item of $input.all()) {\n" +
        "  const binaryKeys = Object.keys(item.binary || {});\n" +
        "  if (binaryKeys.length === 0) continue;\n\n" +
        "  for (const key of binaryKeys) {\n" +
        "    const bin = item.binary[key];\n" +
        "    if (!bin || bin.mimeType !== 'application/pdf') continue;\n\n" +
        "    const fileName = bin.fileName || '';\n" +
        "    const subject = item.json.subject || '';\n" +
        "    const looksLikeInvoice = invoiceHints.test(fileName) || invoiceHints.test(subject);\n" +
        "    if (!looksLikeInvoice) continue;\n\n" +
        "    output.push({\n" +
        "      json: {\n" +
        "        emailId: item.json.id,\n" +
        "        threadId: item.json.threadId,\n" +
        "        subject,\n" +
        "        from: item.json.from,\n" +
        "        attachmentFileName: fileName\n" +
        "      },\n" +
        "      binary: { data: bin }\n" +
        "    });\n" +
        "  }\n" +
        "}\n\n" +
        "return output;"
    }
  },
  output: [{
    emailId: '18c9f2a1b3d4e5f6',
    subject: 'Invoice #INV-1042 from Acme Corp',
    from: 'billing@acme.com',
    attachmentFileName: 'invoice.pdf'
  }]
});

const extractPdfText = node({
  type: 'n8n-nodes-base.extractFromFile',
  version: 1.1,
  config: {
    name: 'Extract Text From PDF',
    position: [-928, 0],
    parameters: {
      operation: 'pdf',
      options: { joinPages: true }
    }
  },
  output: [{
    text: 'Acme Corp\nInvoice #INV-1042\nDate: 2026-08-01\nDue: 2026-08-15\nTotal: USD 1,250.00',
    numpages: 1
  }]
});

// NOTE: switched from OpenAI Chat Model to Groq Chat Model (user has Groq credentials).
const groqModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatGroq',
  version: 1,
  config: {
    name: 'Groq Model',
    position: [-768, 224],
    parameters: {
      model: 'llama-3.1-8b-instant',
      options: { temperature: 0 }
    },
    credentials: { groqApi: newCredential('Groq account') }
  }
});

// NOTE: switched from AI Agent + Structured Output Parser to Information Extractor.
// The Agent node's multi-turn tool-calling protocol returned "400 Bad Request" from
// Groq's API whenever the model needed to return real field values (Groq's function
// calling is stricter than OpenAI's about the tool-call round trip). Information
// Extractor does structured extraction in a single call and works reliably with Groq.
const extractInvoiceData = node({
  type: '@n8n/n8n-nodes-langchain.informationExtractor',
  version: 1.2,
  config: {
    name: 'Extract Invoice Data (AI)',
    position: [-720, -80],
    parameters: {
      text: expr('{{ $json.text }}'),
      schemaType: 'manual',
      inputSchema: JSON.stringify({
        type: 'object',
        properties: {
          is_invoice: { type: 'boolean', description: 'true only if this document is a genuine invoice/bill/receipt/statement' },
          vendor: { type: ['string', 'null'] },
          invoice_number: { type: ['string', 'null'] },
          invoice_date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
          due_date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
          currency: { type: ['string', 'null'], description: 'ISO 4217 code e.g. USD' },
          subtotal: { type: ['number', 'null'] },
          tax: { type: ['number', 'null'] },
          total_amount: { type: ['number', 'null'] },
          payment_status: { type: ['string', 'null'], description: 'one of: paid, unpaid, overdue, pending, unknown' },
          description: { type: ['string', 'null'], description: 'short one-line summary of what was purchased' }
        },
        required: ['is_invoice']
      }, null, 2),
      options: {
        systemPromptTemplate:
          'You are an invoice-data-extraction engine. You will be given raw text extracted from a PDF that may or may not be a genuine invoice. Extract the fields defined by the schema. If the document is not actually an invoice, or required fields cannot be confidently determined, set "is_invoice" to false and leave uncertain fields null. Never fabricate numbers.'
      }
    },
    subnodes: { model: groqModel }
  },
  output: [{
    output: {
      is_invoice: true,
      vendor: 'Acme Corp',
      invoice_number: 'INV-1042',
      invoice_date: '2026-08-01',
      due_date: '2026-08-15',
      currency: 'USD',
      subtotal: 1150.0,
      tax: 100.0,
      total_amount: 1250.0,
      payment_status: 'unpaid',
      description: 'Monthly SaaS subscription'
    }
  }]
});

const parseAndValidate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse & Validate Extraction',
    position: [-400, 0],
    onError: 'stopWorkflow',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const agentOut = $input.first().json.output;\n\n" +
        "if (!agentOut || agentOut.is_invoice !== true) {\n" +
        "  throw new Error('Document classified as NOT an invoice, or extraction failed.');\n" +
        "}\n\n" +
        "const required = ['vendor', 'invoice_number', 'total_amount', 'currency'];\n" +
        "for (const field of required) {\n" +
        "  const v = agentOut[field];\n" +
        "  if (v === null || v === undefined || v === '') {\n" +
        "    throw new Error('Missing required field \"' + field + '\" in extracted invoice data.');\n" +
        "  }\n" +
        "}\n\n" +
        "function sanitize(s) {\n" +
        "  return String(s).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');\n" +
        "}\n\n" +
        "const vendor = sanitize(agentOut.vendor);\n" +
        "const invoiceNumber = sanitize(agentOut.invoice_number);\n" +
        "const dateStr = agentOut.invoice_date ? sanitize(agentOut.invoice_date) : 'unknown_date';\n" +
        "const driveFileName = vendor + '_' + invoiceNumber + '_' + dateStr + '.pdf';\n\n" +
        "const source = $('Validate & Filter Attachments').first();\n\n" +
        "return [{\n" +
        "  json: {\n" +
        "    ...agentOut,\n" +
        "    vendor,\n" +
        "    invoice_number: invoiceNumber,\n" +
        "    driveFileName,\n" +
        "    emailId: source.json.emailId,\n" +
        "    sourceFileName: source.json.attachmentFileName\n" +
        "  },\n" +
        "  binary: source.binary\n" +
        "}];"
    }
  },
  output: [{
    is_invoice: true,
    vendor: 'Acme_Corp',
    invoice_number: 'INV_1042',
    invoice_date: '2026-08-01',
    due_date: '2026-08-15',
    currency: 'USD',
    subtotal: 1150.0,
    tax: 100.0,
    total_amount: 1250.0,
    payment_status: 'unpaid',
    description: 'Monthly SaaS subscription',
    driveFileName: 'Acme_Corp_INV_1042_2026-08-01.pdf',
    emailId: '18c9f2a1b3d4e5f6',
    sourceFileName: 'invoice.pdf'
  }]
});

const uploadToDrive = node({
  type: 'n8n-nodes-base.googleDrive',
  version: 3,
  config: {
    name: 'Upload to Google Drive',
    position: [-160, 0],
    parameters: {
      resource: 'file',
      operation: 'upload',
      inputDataFieldName: 'data',
      name: expr('{{ $json.driveFileName }}'),
      driveId: { __rl: true, mode: 'list', value: 'My Drive' },
      folderId: { __rl: true, mode: 'id', value: 'REPLACE_WITH_INVOICES_FOLDER_ID' }
    },
    credentials: { googleDriveOAuth2Api: newCredential('Google Drive account') }
  },
  output: [{
    id: '1AbCdEfGhIjKlMnOpQrStUvWxYz',
    name: 'Acme_Corp_INV_1042_2026-08-01.pdf',
    webViewLink: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view'
  }]
});

const insertInvoice = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Insert Invoice (Supabase)',
    position: [80, 0],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'row',
      operation: 'create',
      tableId: 'invoices',
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          { fieldId: 'vendor', fieldValue: expr("{{ $('Parse & Validate Extraction').item.json.vendor }}") },
          { fieldId: 'invoice_number', fieldValue: expr("{{ $('Parse & Validate Extraction').item.json.invoice_number }}") },
          { fieldId: 'invoice_date', fieldValue: expr("{{ $('Parse & Validate Extraction').item.json.invoice_date }}") },
          { fieldId: 'due_date', fieldValue: expr("{{ $('Parse & Validate Extraction').item.json.due_date }}") },
          { fieldId: 'currency', fieldValue: expr("{{ $('Parse & Validate Extraction').item.json.currency }}") },
          { fieldId: 'subtotal', fieldValue: expr("{{ $('Parse & Validate Extraction').item.json.subtotal }}") },
          { fieldId: 'tax', fieldValue: expr("{{ $('Parse & Validate Extraction').item.json.tax }}") },
          { fieldId: 'total_amount', fieldValue: expr("{{ $('Parse & Validate Extraction').item.json.total_amount }}") },
          { fieldId: 'payment_status', fieldValue: expr("{{ $('Parse & Validate Extraction').item.json.payment_status }}") },
          { fieldId: 'description', fieldValue: expr("{{ $('Parse & Validate Extraction').item.json.description }}") },
          { fieldId: 'drive_file_url', fieldValue: expr('{{ $json.webViewLink }}') },
          { fieldId: 'drive_file_id', fieldValue: expr('{{ $json.id }}') },
          { fieldId: 'email_id', fieldValue: expr("{{ $('Parse & Validate Extraction').item.json.emailId }}") }
        ]
      }
    },
    credentials: { supabaseApi: newCredential('Supabase account') }
  },
  output: [{ id: 1, vendor: 'Acme_Corp', invoice_number: 'INV_1042', total_amount: 1250.0 }]
});

export default workflow('invoice-processing', 'InvoiceAgent - Automated Invoice Processing')
  .add(gmailTrigger)
  .to(validateAttachments)
  .to(extractPdfText)
  .to(extractInvoiceData)
  .to(parseAndValidate)
  .to(uploadToDrive)
  .to(insertInvoice);
