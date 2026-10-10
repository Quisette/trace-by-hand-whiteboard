// Request corpus shared by tests/jev-api.js: well-formed requests, malformed ones (the official wire model rejects
// them, and so does the server with the same error list) and ones only this server rejects.
const OK = (body) => ({ state: 'x', model: 'jev-latest', questions: { a: { type: 'noul', instructions: 'Is it?' } }, ...body });

const BAD = [
  ['missing everything', {}],
  ['state is a number', OK({ state: 5 })], ['state is null', OK({ state: null })], ['state is boolean', OK({ state: true })],
  ['model is a number', OK({ model: 5 })],
  ['questions is a list', OK({ questions: [1] })], ['questions is empty', OK({ questions: {} })],
  ['question is a number', OK({ questions: { a: 5 } })], ['question without type', OK({ questions: { a: { instructions: 'x' } } })], ['unknown question type', OK({ questions: { a: { type: 'bogus' } } })],
  ['instructions is a number', OK({ questions: { a: { type: 'noul', instructions: 5 } } })],
  ['choice without criteria', OK({ questions: { a: { type: 'choice' } } })], ['choice criteria is a list', OK({ questions: { a: { type: 'choice', criteria: ['x'] } } })],
  ['choice description is a number', OK({ questions: { a: { type: 'choice', criteria: { x: 5 } } } })],
  ['score without criteria', OK({ questions: { a: { type: 'score' } } })], ['score criteria is an object', OK({ questions: { a: { type: 'score', criteria: { x: 'y' } } } })],
  ['score criteria is empty', OK({ questions: { a: { type: 'score', criteria: [] } } })], ['score level is null', OK({ questions: { a: { type: 'score', criteria: [null] } } })],
  ['score level is a number', OK({ questions: { a: { type: 'score', criteria: ['ok', 5] } } })],
  ['noul criteria is a list', OK({ questions: { a: { type: 'noul', instructions: 'x', criteria: ['y'] } } })], ['noul criteria.true is a number', OK({ questions: { a: { type: 'noul', criteria: { true: 5 } } } })],
  ['two bad questions at once', OK({ questions: { a: { type: 'bogus' }, b: { type: 'score', criteria: [] } } })],
];
const STRICTER = [ // the wire model accepts these; this server rejects them (the SDK also refuses them client-side)
  ['noul with neither instructions nor criteria', OK({ questions: { a: { type: 'noul' } } })],
  ['choice with no choices', OK({ questions: { a: { type: 'choice', criteria: {} } } })],
];
const GOOD = [
  OK({}), OK({ state: { subject: 's', body: 'b' } }), OK({ state: ['a', 'b'] }),
  OK({ questions: { a: { type: 'choice', criteria: { x: null, y: 'why', z: ['p', 'q'], w: { meaning: 'm', examples: ['e'] } } } } }),
  OK({ questions: { a: { type: 'score', criteria: ['lo', { level: 'mid' }, ['hi']] }, b: { type: 'noul', criteria: { false: 'no' } } } }),
  OK({ questions: { a: { type: 'noul', instructions: ['is', 'it'], criteria: { true: null, false: 'no' } } }, extra_field: 1 }),
  OK({ model: 'jev-local-1' }),
];

module.exports = { OK, BAD, STRICTER, GOOD };
