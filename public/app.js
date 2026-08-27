const state = { user: null, posts: [], currentThreadId: null, seenMessageIds: new Set() };
let wsConnected = false;

function h(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  for (const [key, val] of Object.entries(opts.attrs || {})) node.setAttribute(key, val);
  if (opts.onClick) node.addEventListener('click', opts.onClick);
  children.forEach(c => node.appendChild(c));
  return node;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur inconnue.');
  return data;
}

// --- Écrans ---

function computeScreen() {
  if (!state.user) return 'auth';
  if (state.user.provider === 'local' && !state.user.emailVerified) return 'verify';
  return 'app';
}

async function updateScreen() {
  const screen = computeScreen();
  document.getElementById('auth-screen').classList.toggle('hidden', screen !== 'auth');
  document.getElementById('verify-screen').classList.toggle('hidden', screen !== 'verify');
  document.getElementById('app-screen').classList.toggle('hidden', screen !== 'app');

  if (screen === 'app') {
    document.getElementById('account-avatar').src = state.user.avatarUrl;
    if (!state.posts.length) await loadPosts();
    if (!wsConnected) {
      wsConnected = true;
      connectWebSocket();
    }
    await renderRoute();
  }
}

// --- Authentification ---

document.getElementById('show-signup').addEventListener('click', () => {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('signup-view').classList.remove('hidden');
});
document.getElementById('show-login').addEventListener('click', () => {
  document.getElementById('signup-view').classList.add('hidden');
  document.getElementById('login-view').classList.remove('hidden');
});

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  try {
    const { user } = await api('/auth/login', {
      method: 'POST',
      body: { email: form.email.value, password: form.password.value },
    });
    state.user = user;
    await updateScreen();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById('signup-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById('signup-error');
  errorEl.textContent = '';
  try {
    const { user } = await api('/auth/signup', {
      method: 'POST',
      body: {
        email: form.email.value,
        password: form.password.value,
        displayName: form.displayName.value,
        avatarUrl: form.avatarUrl.value,
      },
    });
    state.user = user;
    await updateScreen();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById('resend-button').addEventListener('click', async () => {
  const msg = document.getElementById('resend-message');
  msg.textContent = '';
  try {
    await api('/auth/resend-verification', { method: 'POST' });
    msg.textContent = "Email renvoyé si l'envoi est configuré côté serveur.";
  } catch (err) {
    msg.textContent = err.message;
  }
});

async function doLogout() {
  await api('/auth/logout', { method: 'POST' });
  state.user = null;
  state.posts = [];
  state.currentThreadId = null;
  await updateScreen();
}
document.getElementById('verify-logout-button').addEventListener('click', doLogout);
document.getElementById('logout-button').addEventListener('click', doLogout);

// --- Menu compte ---

document.getElementById('account-button').addEventListener('click', () => {
  document.getElementById('account-menu').classList.toggle('hidden');
});
document.addEventListener('click', e => {
  const menu = document.getElementById('account-menu');
  const btn = document.getElementById('account-button');
  if (!menu.classList.contains('hidden') && !menu.contains(e.target) && !btn.contains(e.target)) {
    menu.classList.add('hidden');
  }
});
document.getElementById('open-account').addEventListener('click', () => {
  document.getElementById('account-menu').classList.add('hidden');
  showAccountView();
});
document.getElementById('close-account').addEventListener('click', () => {
  document.getElementById('account-view').classList.add('hidden');
  renderRoute();
});

function showAccountView() {
  document.getElementById('post-placeholder').classList.add('hidden');
  document.getElementById('thread-view').classList.add('hidden');
  document.getElementById('account-view').classList.remove('hidden');
  highlightActivePost(null);
  const form = document.getElementById('account-form');
  form.displayName.value = state.user.displayName;
  form.avatarUrl.value = state.user.avatarUrl;
}

document.getElementById('account-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById('account-error');
  errorEl.textContent = '';
  try {
    const { user } = await api('/auth/profile', {
      method: 'POST',
      body: { displayName: form.displayName.value, avatarUrl: form.avatarUrl.value },
    });
    state.user = user;
    document.getElementById('account-avatar').src = user.avatarUrl;
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// --- Routing (un post = une URL) ---

function navigate(threadId) {
  const path = threadId ? `/${threadId}` : '/';
  history.pushState({}, '', path);
  renderRoute();
}
window.addEventListener('popstate', renderRoute);

async function renderRoute() {
  if (computeScreen() !== 'app') return;
  const id = decodeURIComponent(location.pathname.slice(1));
  document.getElementById('account-view').classList.add('hidden');
  if (!id) {
    showPlaceholder();
  } else {
    await openThread(id);
  }
}

function showPlaceholder() {
  state.currentThreadId = null;
  document.getElementById('thread-view').classList.add('hidden');
  document.getElementById('post-placeholder').classList.remove('hidden');
  highlightActivePost(null);
}

// --- Posts ---

async function loadPosts() {
  const { posts } = await api('/api/posts');
  state.posts = posts;
  renderPosts();
}

function upsertPostInList(post) {
  const idx = state.posts.findIndex(p => p.id === post.id);
  if (idx === -1) state.posts.unshift(post);
  else state.posts[idx] = post;
  renderPosts();
}

function renderPosts() {
  const list = document.getElementById('posts-list');
  list.innerHTML = '';
  state.posts.forEach(post => {
    const li = h('li', {
      class: 'post-item' + (post.id === state.currentThreadId ? ' is-active' : ''),
      attrs: { 'data-id': post.id },
      onClick: () => navigate(post.id),
    });
    li.appendChild(h('h3', { text: post.title }));
    if (post.tags.length) li.appendChild(h('div', { class: 'tags', text: post.tags.join(', ') }));
    if (post.excerpt) li.appendChild(h('p', { class: 'excerpt', text: post.excerpt }));
    li.appendChild(h('span', { class: 'meta', text: `${post.messageCount} message(s)` }));
    list.appendChild(li);
  });
}

function highlightActivePost(threadId) {
  state.currentThreadId = threadId;
  document.querySelectorAll('#posts-list .post-item').forEach(li => {
    li.classList.toggle('is-active', li.dataset.id === threadId);
  });
}

async function openThread(id) {
  highlightActivePost(id);
  state.seenMessageIds = new Set();
  document.getElementById('post-placeholder').classList.add('hidden');
  document.getElementById('thread-view').classList.remove('hidden');
  const titleEl = document.getElementById('thread-title');
  const list = document.getElementById('thread-messages');
  titleEl.textContent = '…';
  list.innerHTML = '';
  try {
    const { post, messages } = await api(`/api/posts/${id}`);
    titleEl.textContent = post.title;
    upsertPostInList(post);
    highlightActivePost(id);
    messages.forEach(m => {
      state.seenMessageIds.add(m.id);
      appendMessage(m);
    });
  } catch (err) {
    titleEl.textContent = 'Post introuvable';
  }
}

function appendMessage(m) {
  const list = document.getElementById('thread-messages');
  const header = h('div', { class: 'message-header' });
  if (m.authorAvatar) header.appendChild(h('img', { class: 'avatar', attrs: { src: m.authorAvatar, alt: '' } }));
  header.appendChild(h('strong', { text: m.authorName }));
  const li = h('li', { class: 'message' }, [header, h('p', { text: m.content })]);
  list.appendChild(li);
}

document.getElementById('back-button').addEventListener('click', () => navigate(null));

document.getElementById('new-post-toggle').addEventListener('click', () => {
  document.getElementById('new-post-box').classList.toggle('hidden');
});

document.getElementById('new-post-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById('new-post-error');
  errorEl.textContent = '';
  try {
    const { post } = await api('/api/posts', { method: 'POST', body: { title: form.title.value, content: form.content.value } });
    form.reset();
    document.getElementById('new-post-box').classList.add('hidden');
    upsertPostInList(post);
    navigate(post.id);
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById('reply-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById('reply-error');
  errorEl.textContent = '';
  try {
    const { message } = await api(`/api/posts/${state.currentThreadId}/messages`, {
      method: 'POST',
      body: { content: form.content.value },
    });
    form.reset();
    if (!state.seenMessageIds.has(message.id)) {
      state.seenMessageIds.add(message.id);
      appendMessage(message);
    }
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// --- Temps réel ---

function connectWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${proto}://${location.host}/ws`);
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.type === 'newPost') {
      upsertPostInList(data.post);
    } else if (data.type === 'newMessage') {
      const post = state.posts.find(p => p.id === data.threadId);
      if (post) {
        post.messageCount += 1;
        renderPosts();
      }
      if (state.currentThreadId === data.threadId && !state.seenMessageIds.has(data.message.id)) {
        state.seenMessageIds.add(data.message.id);
        appendMessage(data.message);
      }
    }
  });
  socket.addEventListener('close', () => setTimeout(connectWebSocket, 3000));
}

// --- Démarrage ---

async function init() {
  try {
    const { user } = await api('/auth/me');
    state.user = user;
  } catch {
    state.user = null;
  }
  await updateScreen();
}

init();
