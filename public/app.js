const state = { user: null, posts: [], currentThreadId: null };

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

// --- Authentification ---

function renderAuth() {
  const area = document.getElementById('auth-area');
  area.innerHTML = '';
  if (state.user) {
    area.appendChild(h('span', { text: `Connecté en tant que ${state.user.displayName}` }));
    area.appendChild(h('button', { text: 'Déconnexion', onClick: doLogout }));
  } else {
    showLoginForm();
  }
  document.getElementById('new-post-box').classList.toggle('hidden', !state.user);
  document.getElementById('reply-form').classList.toggle('hidden', !state.user);
}

function showLoginForm() {
  const area = document.getElementById('auth-area');
  area.innerHTML = '';
  area.appendChild(document.getElementById('login-template').content.cloneNode(true));
  document.getElementById('login-form').addEventListener('submit', onLoginSubmit);
  document.getElementById('show-signup').addEventListener('click', showSignupForm);
}

function showSignupForm() {
  const area = document.getElementById('auth-area');
  area.innerHTML = '';
  area.appendChild(document.getElementById('signup-template').content.cloneNode(true));
  document.getElementById('signup-form').addEventListener('submit', onSignupSubmit);
  document.getElementById('show-login').addEventListener('click', showLoginForm);
}

async function onLoginSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  try {
    const { user } = await api('/auth/login', {
      method: 'POST',
      body: { username: form.username.value, password: form.password.value },
    });
    state.user = user;
    renderAuth();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

async function onSignupSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById('signup-error');
  errorEl.textContent = '';
  try {
    const { user } = await api('/auth/signup', {
      method: 'POST',
      body: {
        username: form.username.value,
        password: form.password.value,
        displayName: form.displayName.value,
        avatarUrl: form.avatarUrl.value,
      },
    });
    state.user = user;
    renderAuth();
  } catch (err) {
    errorEl.textContent = err.message;
  }
}

async function doLogout() {
  await api('/auth/logout', { method: 'POST' });
  state.user = null;
  renderAuth();
}

// --- Posts ---

async function loadPosts() {
  const { posts } = await api('/api/posts');
  state.posts = posts;
  renderPosts();
}

function renderPosts() {
  const list = document.getElementById('posts-list');
  list.innerHTML = '';
  state.posts.forEach(post => {
    const li = h('li', { class: 'post-item', onClick: () => openThread(post.id) });
    li.appendChild(h('h3', { text: post.title }));
    if (post.tags.length) li.appendChild(h('div', { class: 'tags', text: post.tags.join(', ') }));
    if (post.excerpt) li.appendChild(h('p', { class: 'excerpt', text: post.excerpt }));
    li.appendChild(h('span', { class: 'meta', text: `${post.messageCount} message(s)` }));
    list.appendChild(li);
  });
}

async function openThread(threadId) {
  state.currentThreadId = threadId;
  document.getElementById('posts-view').classList.add('hidden');
  document.getElementById('thread-view').classList.remove('hidden');
  const post = state.posts.find(p => p.id === threadId);
  document.getElementById('thread-title').textContent = post ? post.title : 'Post';
  const { messages } = await api(`/api/posts/${threadId}`);
  const list = document.getElementById('thread-messages');
  list.innerHTML = '';
  messages.forEach(appendMessage);
}

function appendMessage(m) {
  const list = document.getElementById('thread-messages');
  const header = h('div', { class: 'message-header' });
  if (m.authorAvatar) header.appendChild(h('img', { class: 'avatar', attrs: { src: m.authorAvatar, alt: '' } }));
  header.appendChild(h('strong', { text: m.authorName }));
  const li = h('li', { class: 'message' }, [header, h('p', { text: m.content })]);
  list.appendChild(li);
}

function backToPosts() {
  state.currentThreadId = null;
  document.getElementById('thread-view').classList.add('hidden');
  document.getElementById('posts-view').classList.remove('hidden');
}

document.getElementById('back-button').addEventListener('click', backToPosts);

document.getElementById('new-post-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target;
  const errorEl = document.getElementById('new-post-error');
  errorEl.textContent = '';
  try {
    await api('/api/posts', { method: 'POST', body: { title: form.title.value, content: form.content.value } });
    form.reset();
    await loadPosts();
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
    await api(`/api/posts/${state.currentThreadId}/messages`, { method: 'POST', body: { content: form.content.value } });
    form.reset();
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
      if (state.posts.some(p => p.id === data.post.id)) return;
      state.posts.unshift(data.post);
      if (!document.getElementById('posts-view').classList.contains('hidden')) renderPosts();
    } else if (data.type === 'newMessage') {
      if (state.currentThreadId === data.threadId) appendMessage(data.message);
      const post = state.posts.find(p => p.id === data.threadId);
      if (post) post.messageCount += 1;
    }
  });
  socket.addEventListener('close', () => setTimeout(connectWebSocket, 3000));
}

async function init() {
  try {
    const { user } = await api('/auth/me');
    state.user = user;
  } catch {
    state.user = null;
  }
  renderAuth();
  await loadPosts();
  connectWebSocket();
}

init();
