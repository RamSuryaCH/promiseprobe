const { DynamoDBClient, GetItemCommand, PutItemCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const ddb = new DynamoDBClient({});
const tableName = process.env.TABLE_NAME;

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method === 'POST') return createNote(event);
  if (method === 'GET') return listNotes(event);
  return respond(404, { error: 'not found' });
};

async function createNote(event) {
  const body = parseBody(event);
  const header = event.headers?.['idempotency-key'] || event.headers?.['Idempotency-Key'];
  const key = header || body.idempotencyKey;
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return respond(400, { error: 'text is required' });
  if (!key) return respond(400, { error: 'Idempotency-Key is required' });

  const pk = `idem#${key}`;
  try {
    await ddb.send(new PutItemCommand({
      TableName: tableName,
      Item: marshall({
        pk,
        id: key,
        text,
        createdAt: new Date().toISOString(),
      }),
      ConditionExpression: 'attribute_not_exists(pk)',
    }));
    return respond(201, { note: { id: key, text }, deduped: false });
  } catch (error) {
    if (error.name !== 'ConditionalCheckFailedException') throw error;
    const found = await ddb.send(new GetItemCommand({
      TableName: tableName,
      Key: marshall({ pk }),
    }));
    const note = found.Item ? unmarshall(found.Item) : null;
    if (!note) return respond(409, { error: 'conflict' });
    if (note.text !== text) {
      return respond(409, { error: 'idempotency key reused with a different note' });
    }
    return respond(200, { note: { id: note.id, text: note.text }, deduped: true });
  }
}

async function listNotes(event) {
  const text = event.queryStringParameters?.text;
  const result = await ddb.send(new ScanCommand({
    TableName: tableName,
    ...(text
      ? {
          FilterExpression: '#text = :text',
          ExpressionAttributeNames: { '#text': 'text' },
          ExpressionAttributeValues: marshall({ ':text': text }),
        }
      : {}),
  }));
  const notes = (result.Items ?? []).map((item) => {
    const note = unmarshall(item);
    return { id: note.id, text: note.text, createdAt: note.createdAt };
  });
  return respond(200, { notes });
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  return JSON.parse(raw);
}
