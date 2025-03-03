import express from 'express';
import http from 'http';
import fs from 'fs';
import YAML from 'yaml';
import jwt from 'jsonwebtoken';
import bearerToken from 'express-bearer-token';
import {Server} from 'socket.io';
import {lorem} from 'txtgen';

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = 3000;
const secret = 'thisismylittlesecret';

const store = {
  topologies: [],
  labs: [],
  devices: [],
  collections: [],
  users: [],
  statusMessages: {},
};

await loadTestData();

app.use(express.json());
app.use(bearerToken());

app.get('/', (req, res) => {
  res.send('Failed to find');
});

app.get('/devices', (req, res) => {
  const user = authenticateUser(req.token);
  if (!user) {
    res.status(403).send('Unauthorized');
    return;
  }

  res.send({payload: store.devices});
});

app.get('/topologies', (req, res) => {
  const user = authenticateUser(req.token);
  if (!user) {
    res.status(403).send('Unauthorized');
    return;
  }

  res.send({payload: getUserTopologies(user)});
});

app.post('/topologies', (req, res) => {
  const user = authenticateUser(req.token);
  if (!user) {
    res.status(403).send('Unauthorized');
    return;
  }

  const newTopology = req.body;

  const targetCollection = store.collections.find(
    collection => collection.id === req.body.collectionId
  );

  if (!targetCollection) {
    res.send(generateError('Specified collection does not exist.'));
    return;
  }

  const topologyId = uuidv4();

  store.topologies.push({
    id: topologyId,
    creatorId: user.id,
    collectionId: targetCollection.id,
    definition: newTopology.definition,
  });

  res.send({payload: {id: topologyId}});
});

app.patch('/topologies/:topologyId', (req, res) => {
  const user = authenticateUser(req.token);
  if (!user) {
    res.status(403).send('Unauthorized');
    return;
  }

  const updatedDefinition = req.body.definition;
  const targetTopology = store.topologies.find(
    topology => topology.id === req.params.topologyId
  );

  if (!targetTopology) {
    res.send(generateError('Specified topology does not exist.'));
    return;
  }

  targetTopology.definition = updatedDefinition;

  res.send({});
});

app.delete('/topologies/:topologyId', (req, res) => {
  const user = authenticateUser(req.token);
  if (!user) {
    res.status(403).send('Unauthorized');
    return;
  }

  const targetTopology = store.topologies.find(
    topology => topology.id === req.params.topologyId
  );

  if (!targetTopology) {
    res.send(generateError('Specified topology does not exist.'));
    return;
  }

  store.topologies.splice(store.topologies.indexOf(targetTopology), 1);

  res.send({});
});

app.get('/collections', (req, res) => {
  const user = authenticateUser(req.token);
  if (!user) {
    res.status(403).send('Unauthorized');
    return;
  }

  res.send({payload: getUserCollections(user)});
});

app.post('/collections', (req, res) => {
  const user = authenticateUser(req.token);
  if (!user) {
    res.status(403).send('Unauthorized');
    return;
  }

  const newCollection = req.body;

  if (store.collections.filter(collection => collection.name === newCollection.name) > 0) {
    res.send(generateError('A collection with that name already exists.'));
    return;
  }

  const collectionId = uuidv4();

  store.collections.push({
    id: collectionId,
    name: newCollection.name,
    publicWrite: newCollection.publicWrite,
    publicDeploy: newCollection.publicDeploy,
  });

  user.collections.push(collectionId);

  res.send({});
});

app.delete('/collections/:collectionId', (req, res) => {
  const user = authenticateUser(req.token);
  if (!user) {
    res.status(403).send('Unauthorized');
    return;
  }

  const targetCollection = store.collections.find(
    collection => collection.id === req.params.collectionId
  );

  if (!targetCollection) {
    res.send(generateError('Specified collections does not exist.'));
    return;
  }

  store.collections = store.collections.toSpliced(store.collections.indexOf(targetCollection), 1);

  res.send({});
});

app.patch('/collections/:collectionId', (req, res) => {
  const user = authenticateUser(req.token);
  if (!user) {
    res.status(403).send('Unauthorized');
    return;
  }

  const updatedCollection = req.body;
  const targetCollection = store.collections.find(
    collection => collection.id === req.params.collectionId
  );

  if (!targetCollection) {
    res.send(generateError('Specified collection does not exist.'));
    return;
  }

  if (store.collections.filter(collection => collection.name === updatedCollection.name) > 1) {
    res.send(generateError('A collection with that name already exists.'));
    return;
  }

  targetCollection.name = updatedCollection.name;
  targetCollection.publicWrite = updatedCollection.publicWrite;
  targetCollection.publicDeploy = updatedCollection.publicDeploy;

  res.send({});
});

app.get('/status-messages', (req, res) => {
  const user = authenticateUser(req.token);
  if (!user) {
    res.status(403).send('Unauthorized');
    return;
  }

  res.send({payload: getUserStatusMessages(user)});
});

app.get('/labs', (req, res) => {
  const user = authenticateUser(req.token);
  if (!user) {
    res.status(403).send('Unauthorized');
    return;
  }

  const {filteredLabs, totalLabsCount} = filterLabs(
    getUserLabs(user),
    req.query.limit,
    req.query.offset,
    req.query.searchQuery,
    req.query.stateFilter,
    req.query.collectionFilter,
    req.query.startDate,
    req.query.endDate
  );

  res.setHeader('X-Total-Count', totalLabsCount);

  res.send({
    payload: filteredLabs.map(lab => {
      const topology = store.topologies.find(
        topology => topology.id === lab.topologyId
      ).definition;
      const nodes = YAML.parse(topology).topology.nodes;

      return {
        ...lab,
        nodeMeta: Object.keys(nodes).map(nodeName => ({
          name: nodeName,
          host: 'example.com',
          port: randomNumber(1000, 65000),
          user: 'ins',
          webSsh: 'console.antimony.network.garden/ssh/' + randomNumber(1, 10),
        })),
      };
    }),
  });
});

app.post('/labs', (req, res) => {
  const user = authenticateUser(req.token);
  if (!user) {
    res.status(403).send('Unauthorized');
    return;
  }

  const newLab = req.body;
  const targetTopology = store.topologies.find(
    topology => topology.id === req.body.topologyId
  );

  const lab = {
    name: newLab.name,
    startDate: newLab.startDate,
    endDate: newLab.endDate,
    collectionId: targetTopology.collectionId,
    topologyId: targetTopology.id,
    nodeMeta: {
      'srl/nokia_srlinux': {
        user: 'ins',
        host: 'example.com',
        port: 9003,
        webSsh: 'console.ltb3.network.garden/whatever/stuff',
      },
    },
    edgesharkLink: 'edgeshark.example.com/whatever',
    runnerId: user.id,
    latestStateChange: new Date().toISOString(),
    state: 0,
  };

  store.labs.push(lab);

  // TODO(kian): Maybe change this to actually take scheduling into account
  labQueue.push([lab, Date.now(), randomNumber(2000, 4000)]);

  res.send({});
});

app.patch('/labs/:id', (req, res) => {
  const user = authenticateUser(req.token);
  if (!user) {
    res.status(403).send('Unauthorized');
    return;
  }

  const targetLab = store.labs.find(lab => lab.id === req.params.id);
  if (!targetLab) {
    res.status(404).send({message: 'Lab not found.'});
    return;
  }
  const now = new Date(Date.now());
  targetLab.startDate = req.body.startDate;
  if (req.body.endDate !== '') {
    targetLab.endDate = req.body.endDate;
  }

  res.send({});

  labQueue.push([targetLab, Date.now(), randomNumber(2000, 4000)]);
});

app.post('/users/auth', (req, res) => {
  const body = req.body;
  const user = findUser(body.username, body.password);
  if (!user) {
    res.send(generateError('Invalid credentials'));
    return;
  }

  res.send({
    payload: {
      token: jwt.sign({user: user.id}, secret),
      isAdmin: user.isAdmin,
    },
  });
});

const labQueue = [];
const messageQueue = [];
const socketMap = new Map();

io.on('connection', socket => {
  console.log('[SIO] A new client connected via socket.io');
  const user = authenticateUser(socket.handshake.auth.token);
  if (!user) {
    socket.disconnect();
    return;
  }

  socketMap.set(user.id, socket);

  socket.on('disconnect', () => {
    console.log('[SIO] A client has disconnected from socket.io');
    socketMap.delete(user.id);
  });
});

server.listen(port, () => {
  console.log('[APP] Antimony server ready...');
});

function generateError(message) {
  return {
    code: 400,
    message: message,
  };
}

function authenticateUser(token) {
  try {
    return store.users.find(user => user.id === jwt.verify(token, secret).user);
  } catch (err) {
    console.error('[APP] Failed to decode JWT. Skipping.');
    return null;
  }
}

function findUser(username, password) {
  for (let user of store.users) {
    if (user.username === username && user.password === password) {
      return user;
    }
  }
  return null;
}

function filterLabs(
  labs,
  limit,
  offset,
  query,
  stateFilter,
  collectionFilter,
  startDate,
  endDate
) {
  let filteredLabs = labs;

  try {
    stateFilter = JSON.parse(stateFilter).map(id => Number(id));
    if (stateFilter.length > 0) {
      filteredLabs = filteredLabs.filter(lab =>
        stateFilter.includes(lab.state)
      );
    }
  } catch (err) {}

  try {
    query = JSON.parse(query);
    if (query.length > 0) {
      filteredLabs = filteredLabs.filter(lab => {
        const nameMatch = lab.name.includes(query.toString());
        const collection = store.collections.find(collection => collection.id === lab.collectionId);
        const collectionMatch = collection && collectionMatch.name.includes(query.toString());

        return nameMatch || collectionMatch;
      });
    }
  } catch (err) {}
  try {
    collectionFilter = JSON.parse(collectionFilter);
    if (collectionFilter.length > 0) {
      filteredLabs = filteredLabs.filter(lab =>
        collectionFilter.includes(lab.collectionId)
      );
    }
  } catch (err) {}
  if (startDate && !isNaN(Date.parse(JSON.parse(startDate)))) {
    startDate = Date.parse(JSON.parse(startDate));
    filteredLabs = filteredLabs.filter(
      lab => Date.parse(lab.startDate) > startDate
    );
  }

  if (endDate && !isNaN(Date.parse(JSON.parse(endDate)))) {
    endDate = Date.parse(JSON.parse(endDate));
    filteredLabs = filteredLabs.filter(
      lab => Date.parse(lab.startDate) < endDate
    );
  }

  const totalLabsCount = filteredLabs.length;

  filteredLabs.sort(
    (l1, l2) => new Date(l1.startDate) - new Date(l2.startDate)
  );

  if (offset !== undefined && !isNaN(Number(offset))) {
    filteredLabs = filteredLabs.slice(Number(offset), filteredLabs.length);
  }

  if (limit !== undefined && !isNaN(Number(limit))) {
    filteredLabs = filteredLabs.slice(0, Number(limit));
  }

  return {filteredLabs, totalLabsCount};
}

function getUserLabs(user) {
  return user.collections
    .map(collectionId => store.collections.find(collection => collection.id === collectionId))
    .filter(collection => collection)
    .flatMap(collection => store.labs.filter(lab => lab.collectionId === collection.id));
}

function getUserCollections(user) {
  return user.collections
    .map(collectionId => store.collections.find(collection => collection.id === collectionId))
    .filter(collection => collection);
}

function getUserStatusMessages(user) {
  return store.statusMessages[user.id] ?? [];
}

function getUserTopologies(user) {
  return user.collections
    .map(collectionId => store.collections.find(collection => collection && collection.id === collectionId))
    .filter(collection => collection && (user.isAdmin || collection.publicDeploy || collection.publicWrite))
    .flatMap(collection =>
      store.topologies.filter(topology => topology.collectionId === collection.id)
    );
}

async function generateRandomStatusMessage() {
  return {
    id: uuidv4(),
    timestamp: new Date(),
    summary: makeTitle(lorem(4, 8)) + '.',
    detail: (await (await fetch('https://meowfacts.herokuapp.com/')).json())[
      'data'
    ][0],
    severity: Math.floor(Math.random() * 4),
  };
}

async function generateStatusMessageTestData(users) {
  const messages = {};

  for (const user of users) {
    messages[user.id] = [];
    const amount = Math.floor(Math.random() * 10);
    for (let i = 0; i < amount; i++) {
      messages[user.id].push(await generateRandomStatusMessage());
    }
  }

  return messages;
}

function makeTitle(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

async function loadTestData() {
  store.topologies = readDataFile('topologies.yaml');
  store.labs = readDataFile('labs.yaml');
  store.devices = readDataFile('devices.yaml');
  store.collections = readDataFile('collections.yaml');
  store.users = readDataFile('users.yaml');
  store.statusMessages = await generateStatusMessageTestData(store.users);

  for (const userId in store.statusMessages) {
    for (const notif of store.statusMessages[userId]) {
      notif.detail = (
        await (await fetch('https://meowfacts.herokuapp.com/')).json()
      )['data'][0];
    }
  }
}

function readDataFile(fileName) {
  try {
    return YAML.parse(fs.readFileSync(`./data/${fileName}`, 'utf8'));
  } catch (err) {
    console.error(`[APP] Failed to read data from '${fileName}'. Aborting.`);
    console.error(`[APP]   Error info: ${err}`);
    process.exit(1);
  }
}

function randomNumber(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

function uuidv4() {
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
    (
      +c ^
      (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))
    ).toString(16)
  );
}

function executeLabStep() {
  if (labQueue.length === 0) return;

  const [lab] = labQueue.find(
    ([, start, cooldown]) => start - Date.now() < cooldown
  );
  if (!lab) return;

  labQueue.splice(labQueue.indexOf(lab), 1);

  let messageSummary = '[SERVER] Deployment Update';
  let messageDetail = null;
  let messageSeverity = '';

  switch (lab.state) {
    case 0:
      lab.state = 1;
      lab.latestStateChange = new Date().toISOString();
      messageDetail = `Deployment of lab "${lab.name}" has been started.`;
      messageSeverity = 2;
      labQueue.push([lab, Date.now(), randomNumber(5000, 10000)]);
      break;
    case 1:
      if (randomNumber(0, 100) > 50) {
        lab.state = 2;
        lab.latestStateChange = new Date().toISOString();
        messageDetail = `Lab "${lab.name}" has been successfully deployed.`;
        messageSeverity = 2;
      } else {
        lab.state = 3;
        lab.latestStateChange = new Date().toISOString();
        messageDetail = `Deployment of lab "${lab.name}" has failed!`;
        messageSeverity = 0;
      }
      break;
  }

  if (messageDetail) {
    const message = {
      id: uuidv4(),
      timestamp: new Date(),
      summary: messageSummary,
      detail: messageDetail,
      severity: messageSeverity,
    };
    messageQueue.push({
      userId: lab.runnerId,
      data: message,
    });
    for (let [, socket] of socketMap.entries()) {
      socket.emit('labsUpdate');
    }
  }
}

function executeMessageStep() {
  if (messageQueue.length === 0) return;

  const message = messageQueue.pop();
  if (!socketMap.has(message.userId)) return;

  socketMap.get(message.userId).emit('status-message', message.data);
}

function executeSteps() {
  executeLabStep();
  executeMessageStep();

  setTimeout(executeSteps, Math.floor(Math.random() * (6 - 2) + 6) * 1000);
}

executeSteps();
