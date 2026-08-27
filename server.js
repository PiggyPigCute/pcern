require('dotenv').config();

const http = require('http');
const path = require('path');
const express = require('express');

const discord = require('./src/discord');
const ws = require('./src/ws');
const authRoutes = require('./src/routes/auth');
const postsRoutes = require('./src/routes/posts');

const PORT = process.env.PORT || 3006;
const { DISCORD_TOKEN, GUILD_ID, FORUM_CHANNEL_ID } = process.env;

const missing = [
  'DISCORD_TOKEN',
  'GUILD_ID',
  'FORUM_CHANNEL_ID',
  'SITE_URL',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
].filter(name => !process.env[name]);
if (missing.length) {
  console.error(`Variables d'environnement manquantes : ${missing.join(', ')} (voir .env.example)`);
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1); // derrière nginx : nécessaire pour que req.secure reflète X-Forwarded-Proto

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/auth', authRoutes);
app.use('/api/posts', postsRoutes);

// routing client (posts avec une URL dédiée) : toute route GET restante sert
// la page unique, qui lit location.pathname pour ouvrir le bon post — sinon
// un F5 sur /<id_du_post> renverrait un 404 au lieu de réafficher le post
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = http.createServer(app);
ws.attach(server);

discord
  .init({
    token: DISCORD_TOKEN,
    guild: GUILD_ID,
    forumChannel: FORUM_CHANNEL_ID,
    onEvent: ws.broadcast,
  })
  .then(() => {
    server.listen(PORT, () => console.log(`Portail Citoyen·ne de l'Ernestie lancé sur le port ${PORT}`));
  })
  .catch(err => {
    console.error('Échec de connexion au bot Discord :', err.message);
    process.exit(1);
  });
