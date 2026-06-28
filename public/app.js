// ===================== POKEMON LEAGUE — WEB DASHBOARD =====================

const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
const SPRITE_SHINY_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/';

let allUsers = [];
let currentTrainer = null;
let currentBox = 0;

// ===================== AVATAR HELPER =====================

/**
 * Returns HTML for a round avatar circle — shows <img> if avatarUrl is set,
 * else shows the initial letter. className is the CSS class of the container.
 */
function renderAvatarCircle(className, initial, avatarUrl, imgClass = 'avatar-circle-img') {
    if (avatarUrl) {
        return `<div class="${className}"><img src="${avatarUrl}" class="${imgClass}" alt="Avatar" onerror="this.parentNode.textContent='${escapeHtml(initial)}'"></div>`;
    }
    return `<div class="${className}">${escapeHtml(initial)}</div>`;
}

// ===================== INIT =====================

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal();
    });
    document.getElementById('auth-modal-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeAuthModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeModal(); closeAuthModal(); }
    });

    // Auth form handlers
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('register-form').addEventListener('submit', handleRegister);

    // Restore auth state
    restoreAuth();

    await loadTrainers();
    renderGymLeaders();
    renderPokemonList();
    loadTournament();

    // Auto-refresh every 15 seconds
    setInterval(async () => {
        if (!currentTrainer) {
            await loadTrainers();
        } else {
            await refreshCurrentTrainer();
        }
    }, 15000);
});

async function loadTrainers() {
    try {
        const res = await fetch('/api/users');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        allUsers = await res.json();

        // Sync logged-in user's avatar from DB (in case it was changed elsewhere)
        if (authUser) {
            const me = allUsers.find(u => u.id === authUser.id);
            if (me && me.avatar_url !== authUser.avatar_url) {
                authUser.avatar_url = me.avatar_url;
                localStorage.setItem('avatarUrl', me.avatar_url || '');
                updateAuthUI();
            }
        }

        renderTrainers();
        renderStreams();
        renderRankings();
        renderRoutes();
        renderGymLeaders();
        document.getElementById('loading').classList.add('hidden');
    } catch (err) {
        console.error('Error loading trainers:', err);
        document.getElementById('loading').innerHTML = `
            <div style="text-align:center;color:#ff4757;">
                <p style="font-size:1.2rem;margin-bottom:8px;">❌ Error cargando entrenadores</p>
                <p style="font-size:0.85rem;color:#a0a0c0;">${err.message}</p>
            </div>
        `;
    }
}

async function refreshCurrentTrainer() {
    if (!currentTrainer) return;
    try {
        const res = await fetch(`/api/users/${currentTrainer.id}`);
        if (res.ok) {
            const data = await res.json();
            currentTrainer = data;
            renderTrainerDetail(data);

            // Sync logged-in user's avatar from DB if this is the current user
            if (authUser && data.id === authUser.id && data.avatar_url !== authUser.avatar_url) {
                authUser.avatar_url = data.avatar_url;
                localStorage.setItem('avatarUrl', data.avatar_url || '');
                updateAuthUI();
            }
        }
    } catch (err) {
        console.error('Error refreshing trainer:', err);
    }
}

// ===================== RENDER TRAINERS LIST =====================

function renderTrainers() {
    const grid = document.getElementById('trainers-grid');
    document.getElementById('trainer-count').textContent = allUsers.length;

    if (allUsers.length === 0) {
        grid.innerHTML = `
            <div class="no-data-msg" style="grid-column:1/-1">
                <span class="icon">🏟️</span>
                <p>Aún no hay entrenadores registrados</p>
                <p style="font-size:0.85rem;margin-top:8px;color:var(--text-muted)">Conecta la app de escritorio para sincronizar tu partida</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = '';
    allUsers.forEach(user => {
        const card = document.createElement('div');
        card.className = 'trainer-card';

        const party = user.party || [];
        const boxes = user.boxes || [];
        const nuzlocke = user.nuzlocke || { deaths: [] };
        const boxCount = boxes.reduce((s, b) => s + ((b.slots || []).filter(Boolean).length), 0);
        const partyCount = party.length;
        const deathCount = nuzlocke.deaths ? nuzlocke.deaths.length : 0;

        const updatedAt = user.updated_at
            ? new Date(user.updated_at).toLocaleDateString('es-ES', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
            })
            : 'Sin datos';

        const initial = user.username.charAt(0).toUpperCase();

        // Party preview sprites
        const partyPreviewHTML = party.slice(0, 6).map(p =>
            `<img src="${getSpriteUrl(p.speciesId, p.isShiny)}" alt="${escapeHtml(p.species)}" title="${escapeHtml(p.nickname || p.species)} Lv.${p.level}" width="48" height="48" onerror="this.src='${SPRITE_BASE}0.png'">`
        ).join('');

        card.innerHTML = `
            <div class="trainer-header">
                ${renderAvatarCircle('trainer-avatar', initial, user.avatar_url)}
                <div>
                    <div class="trainer-name">${escapeHtml(user.username)}</div>
                    <div class="trainer-meta">Última sync: ${updatedAt}</div>
                </div>
            </div>
            ${partyPreviewHTML ? `<div class="trainer-party-preview">${partyPreviewHTML}</div>` : ''}
            <div class="trainer-stats">
                <span>⚔️ ${partyCount} en equipo</span>
                <span>📦 ${boxCount} en PC</span>
                ${deathCount > 0 ? `<span>💀 ${deathCount} caídos</span>` : ''}
            </div>
        `;

        card.addEventListener('click', () => viewTrainer(user));
        grid.appendChild(card);
    });
}

// ===================== VIEW TRAINER DETAIL =====================

function viewTrainer(user) {
    currentTrainer = user;
    currentBox = 0;
    document.getElementById('trainers-section').style.display = 'none';
    document.getElementById('detail-section').style.display = 'block';
    // Render immediately with whatever data we have (no boxes yet from /api/users)
    renderTrainerDetail(user);
    // Then fetch full data with boxes and update only the box section
    fetchTrainerWithBoxes(user.id);
}

async function fetchTrainerWithBoxes(userId) {
    // Show loading spinner in box section
    const boxGrid = document.getElementById('detail-box-grid');
    const boxTabs = document.getElementById('detail-box-tabs');
    if (boxTabs) boxTabs.innerHTML = '';
    if (boxGrid) {
        boxGrid.innerHTML = `
            <div class="box-loading">
                <div class="box-loading-pokeball">
                    <div class="pokeball-top"></div>
                    <div class="pokeball-middle"></div>
                    <div class="pokeball-bottom"></div>
                    <div class="pokeball-center"></div>
                </div>
                <div class="box-loading-text">Cargando cajas del PC...</div>
            </div>
        `;
    }
    try {
        const res = await fetch(`/api/users/${userId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const fullData = await res.json();
        currentTrainer = fullData;
        // Only update the box section (don't re-render the whole detail)
        const boxes = fullData.boxes || [];
        renderDetailBoxTabs(boxes);
        renderDetailBox(0, boxes);
        const totalEl = document.getElementById('detail-box-total');
        const totalPokemon = boxes.reduce((s, b) => s + (b.slots || []).filter(Boolean).length, 0);
        if (totalEl) totalEl.textContent = `${totalPokemon} Pokémon`;
    } catch (err) {
        if (boxGrid) {
            boxGrid.innerHTML = `<div class="no-data-msg" style="grid-column:1/-1"><span class="icon">⚠️</span><p>Error cargando cajas</p></div>`;
        }
        console.error('Error fetching boxes:', err);
    }
}

function showTrainerList() {
    currentTrainer = null;
    document.getElementById('trainers-section').style.display = 'block';
    document.getElementById('detail-section').style.display = 'none';
    loadTrainers();
}

// ===================== KALOS BADGES =====================

function getZCrystalSVG(colors, glow, symbol, name = '') {
    const safeId = name 
        ? name.toLowerCase().replace(/[^a-z0-9]/g, '') 
        : 'sym_' + String(symbol).codePointAt(0);
    return `
    <svg viewBox="0 0 100 120" class="z-crystal-svg" style="filter: drop-shadow(0 0 6px ${glow}); width: 100%; height: 100%;">
        <defs>
            <linearGradient id="grad-${safeId}" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="${colors[0]}" />
                <stop offset="50%" stop-color="${colors[1]}" />
                <stop offset="100%" stop-color="${colors[2] || colors[1]}" />
            </linearGradient>
        </defs>
        <polygon points="50,5 90,30 90,90 50,115 10,90 10,30" fill="url(#grad-${safeId})" stroke="rgba(255,255,255,0.7)" stroke-width="1.5" />
        <polygon points="50,20 80,40 80,80 50,100 20,80 20,40" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.25)" stroke-width="1" />
        <line x1="50" y1="5" x2="50" y2="115" stroke="rgba(255,255,255,0.15)" />
        <line x1="10" y1="60" x2="90" y2="60" stroke="rgba(255,255,255,0.1)" />
        <text x="50" y="68" font-size="28" font-family="'Segoe UI Emoji', sans-serif" text-anchor="middle" fill="#ffffff" style="text-shadow: 0 2px 4px rgba(0,0,0,0.5);">${symbol}</text>
    </svg>
    `;
}

const ALOLA_Z_CRYSTALS = [
    { name: 'Normastal Z',    trial: 'Prueba de Liam',          type: 'Normal',    colors: ['#A8A77A', '#C6C5A9', '#737255'], glow: '#A8A77A', symbol: '◯', img: '/badges/normastal.png' },
    { name: 'Lizastal Z',     trial: 'Gran Prueba de Hala (Kahuna)',    type: 'Lucha',     colors: ['#C22E28', '#E35E59', '#8C1E1A'], glow: '#E35E59', symbol: '👊', img: '/badges/lizastal.png' },
    { name: 'Hidrostal Z',    trial: 'Prueba de Nereida',        type: 'Agua',      colors: ['#6390F0', '#89AEF5', '#3D61B0'], glow: '#6390F0', symbol: '💧', img: '/badges/hidrostal.png' },
    { name: 'Pirostal Z',     trial: 'Prueba de Kiawe',                 type: 'Fuego',     colors: ['#F08030', '#F5A670', '#B35310'], glow: '#F08030', symbol: '🔥', img: '/badges/pirostal.png' },
    { name: 'Fitostal Z',     trial: 'Prueba de Lulú',         type: 'Planta',    colors: ['#78C850', '#9CD97F', '#4E962B'], glow: '#78C850', symbol: '🍃', img: '/badges/fitostal.png' },
    { name: 'Litostal Z',     trial: 'Gran Prueba de Olivia (Kahuna)',  type: 'Roca',      colors: ['#B6A136', '#D1C26D', '#7A6B1F'], glow: '#B6A136', symbol: '🪨', img: '/badges/litostal.png' },
    { name: 'Electrostal Z',    trial: 'Prueba de Chris',     type: 'Eléctrico', colors: ['#F7D02C', '#F9DE69', '#A18512'], glow: '#F7D02C', symbol: '⚡', img: '/badges/electrostal.png' },
    { name: 'Espectrostal Z', trial: 'Prueba de Zarala',      type: 'Fantasma',  colors: ['#705797', '#9075B5', '#4A3469'], glow: '#9075B5', symbol: '👻', img: '/badges/espectrostal.png' },
    { name: 'Nictostal Z',    trial: 'Gran Prueba de Denio (Kahuna)',     type: 'Siniestro', colors: ['#705746', '#8A6E5C', '#3C2D23'], glow: '#705746', symbol: '🌙', img: '/badges/nictostal.png' },
    { name: 'Geostal Z',      trial: 'Gran Prueba de Hela',      type: 'Tierra',    colors: ['#E2BF65', '#EAD195', '#9E803A'], glow: '#E2BF65', symbol: '⛰️', img: '/badges/geostal.png' },
    { name: 'Dracostal Z',    trial: 'Prueba del Cañón de Poni',        type: 'Dragón',    colors: ['#6F35FC', '#946BFA', '#4416B8'], glow: '#6F35FC', symbol: '🐲', img: '/badges/dracostal.png' },
    { name: 'Feeristal Z',    trial: 'Prueba de Rika',           type: 'Hada',      colors: ['#D685AD', '#E4B5CD', '#9C4E75'], glow: '#D685AD', symbol: '✨', img: '/badges/feeristal.png' },
    { name: 'Aerostal Z',     trial: 'Encontrado en la Colina Dequil',  type: 'Volador',   colors: ['#A890F0', '#C6B7F5', '#725AB0'], glow: '#A890F0', symbol: '🌪️', img: '/badges/aerostal.png' },
    { name: 'Insectostal Z',  trial: 'Encontrado en la Mansión Po',     type: 'Bicho',     colors: ['#A8B820', '#C6D160', '#738010'], glow: '#A8B820', symbol: '🐛', img: '/badges/insectostal.png' },
    { name: 'Criostal Z',     trial: 'Encontrado en el Monte Lanakila',  type: 'Hielo',     colors: ['#98D8D8', '#BCE6E6', '#59A6A6'], glow: '#98D8D8', symbol: '❄️', img: '/badges/criostal.png' },
    { name: 'Toxistal Z',     trial: 'Regalo de Plumeria',              type: 'Veneno',    colors: ['#A040A0', '#C183C1', '#6D2B6D'], glow: '#A040A0', symbol: '☠️', img: '/badges/toxistal.png' },
    { name: 'Metalostal Z',   trial: 'Regalo de Molayne',               type: 'Acero',     colors: ['#B8B8D0', '#D1D1E0', '#7B7B9C'], glow: '#B8B8D0', symbol: '⚙️', img: '/badges/metalostal.png' },
    { name: 'Psicostal Z',   trial: 'Encontrado en el Desierto de Hano',type: 'Psíquico',  colors: ['#F85888', '#FA94B3', '#A93A5C'], glow: '#F85888', symbol: '🔮', img: '/badges/psicostal.png' },
];

let activeDetailTab = 'actual';

function renderTrainerDetail(user) {
    const detail = document.getElementById('trainer-detail');
    const party = user.party || [];
    const boxes = user.boxes || [];
    const nuzlocke = user.nuzlocke || { deaths: [] };

    const initial = user.username.charAt(0).toUpperCase();
    const updatedAt = user.updated_at
        ? new Date(user.updated_at).toLocaleDateString('es-ES', {
            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        })
        : 'Sin datos';

    detail.innerHTML = `
        <div class="detail-header">
            ${renderAvatarCircle('detail-avatar', initial, user.avatar_url)}
            <div>
                <div class="trainer-name">${escapeHtml(user.username)}</div>
                <div class="trainer-meta">Última sincronización: ${updatedAt}</div>
            </div>
        </div>

        <!-- Tabs -->
        <div class="detail-tabs">
            <button class="detail-tab${activeDetailTab === 'actual' ? ' active' : ''}" data-tab="actual" onclick="switchDetailTab('actual')">🎖️ Actual</button>
            <button class="detail-tab${activeDetailTab === 'pokemon' ? ' active' : ''}" data-tab="pokemon" onclick="switchDetailTab('pokemon')">⚔️ Pokémon</button>
        </div>

        <!-- Tab: Actual -->
        <div class="tab-content" id="tab-actual" style="${activeDetailTab === 'actual' ? '' : 'display:none'}">
            <div id="actual-content"></div>
        </div>

        <!-- Tab: Pokémon -->
        <div class="tab-content" id="tab-pokemon" style="${activeDetailTab === 'pokemon' ? '' : 'display:none'}">
            <section class="party-section">
                <div class="section-title">
                    <span class="icon">⚔️</span>
                    <span>Equipo Actual</span>
                    <span class="count">${party.length}/6</span>
                </div>
                <div class="party-grid" id="detail-party-grid"></div>
            </section>
            <section class="box-section">
                <div class="section-title">
                    <span class="icon">📦</span>
                    <span>Cajas del PC</span>
                    <span class="count" id="detail-box-total">0 Pokémon</span>
                </div>
                <div class="box-tabs" id="detail-box-tabs"></div>
                <div class="box-grid" id="detail-box-grid"></div>
            </section>
            <section class="graveyard-section" id="detail-graveyard" style="display:none">
                <div class="section-title">
                    <span class="icon">💀</span>
                    <span>Cementerio</span>
                    <span class="count" id="detail-graveyard-count">0</span>
                </div>
                <div class="graveyard-grid" id="detail-graveyard-grid"></div>
            </section>
            <section class="cards-section" id="detail-cards" style="display:none; margin-top: 25px;">
                <div class="section-title">
                    <span class="icon">🃏</span>
                    <span>Mano de Cartas</span>
                    <span class="count" id="detail-cards-count">0</span>
                </div>
                <div class="cards-grid" id="detail-cards-grid" style="display:flex; gap:12px; flex-wrap:wrap; margin-top:15px; justify-content: flex-start;"></div>
            </section>
        </div>
    `;

    renderActualContent(user);
    renderDetailParty(party);
    renderDetailBoxTabs(boxes);
    renderDetailBox(0, boxes);
    renderDetailGraveyard(nuzlocke);
    renderDetailCards(nuzlocke);
}

function switchDetailTab(tab) {
    activeDetailTab = tab;
    document.querySelectorAll('.detail-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.getElementById('tab-actual').style.display = tab === 'actual' ? 'block' : 'none';
    document.getElementById('tab-pokemon').style.display = tab === 'pokemon' ? 'block' : 'none';
}

/**
 * Auto-detect whether DB values are raw counts (new app v1.7.1+) or pre-multiplied (old app).
 * Raw counts: earned ≤ 100 (max ~60 challenges), deaths ≤ reasonable count.
 * Pre-multiplied: earned is pre-multiplied by 100 (e.g. 5700).
 * Returns { displayEarned, displayDeaths, displaySpent, displayPoints, challengePoints, cardBonus, spendablePoints }.
 */
function getNuzlockePointsDisplay(user, fallbackDeaths) {
    const earned = user.nuzlocke_points_earned ?? 0;
    const deaths = user.nuzlocke_points_deaths ?? fallbackDeaths ?? 0;
    const spent  = user.nuzlocke_points_spent  ?? 0;

    // Heuristic: if earned ≤ 100, it's a raw challenge count (new format).
    // No player can complete more than ~60 challenges.
    // If earned > 100, it's pre-multiplied (old format, e.g. 5700).
    const isRawFormat = earned <= 100;

    const displayEarned = isRawFormat ? earned * 100 : earned;
    const displayDeaths = isRawFormat ? deaths * 50  : deaths;
    const displaySpent  = spent;
    
    // Puntos de retos menos los puntos gastados en la tienda (los bonos de cartas NO se incluyen)
    const challengePoints = displayEarned - displayDeaths - displaySpent;

    // Puntos de cartas de la ruleta obtenidos como bonus
    const cardBonus = user.nuzlocke?.bonusPoints ?? 0;

    // Puntos disponibles actuales para tienda (saldo spendable)
    const spendablePoints = user.nuzlocke_points ?? (displayEarned + cardBonus - displayDeaths - displaySpent);

    // Mantener displayPoints como el puntaje oficial de los retos (para el ranking)
    const displayPoints = challengePoints;

    return { displayEarned, displayDeaths, displaySpent, displayPoints, challengePoints, cardBonus, spendablePoints };
}

function renderActualContent(user) {
    const container = document.getElementById('actual-content');
    if (!container) return;

    const trainer = user.trainer || {};
    const party = user.party || [];
    const nuzlocke = user.nuzlocke || { deaths: [] };
    const deaths = nuzlocke.deaths || [];
    const badges = trainer.badges || [];

    const trainerName = trainer.name || user.username;
    const initial = trainerName.charAt(0).toUpperCase();
    const tid = trainer.tid || '---';
    const hours = String(trainer.hours || 0).padStart(2, '0');
    const minutes = String(trainer.minutes || 0).padStart(2, '0');
    const seconds = String(trainer.seconds || 0).padStart(2, '0');
    const money = (trainer.money || 0).toLocaleString();
    const badgeCount = trainer.badgeCount || badges.filter(Boolean).length;

    // Points: auto-detect raw counts vs pre-multiplied, use nuzlocke_points as total
    const stats = getTrainerStats(user);
    const { displayEarned, displayDeaths, displaySpent, displayPoints, challengePoints, cardBonus, spendablePoints } = getNuzlockePointsDisplay(user, stats.deaths);

    const badgesHTML = ALOLA_Z_CRYSTALS.map((z, i) => {
        const earned = badges[i] || false;
        const svgContent = getZCrystalSVG(z.colors, earned ? z.glow : 'transparent', z.symbol, z.name);
        return `<div class="badge-item${earned ? ' earned' : ''}">
            <div class="badge-svg-container ${earned ? 'earned' : 'locked'}" style="width: 48px; height: 58px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 4px; position: relative;">
                <img src="${z.img}" style="display: none; width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 0 6px ${earned ? z.glow : 'transparent'})" onload="this.style.display='block'; this.nextElementSibling.style.display='none';" />
                <div style="width: 100%; height: 100%;">${svgContent}</div>
            </div>
            <span class="badge-label">${z.name}</span>
        </div>`;
    }).join('');

    const partyHTML = party.map(poke => {
        if (!poke) return '';
        const spriteUrl = getSpriteUrl(poke.speciesId, poke.isShiny);
        return `<div class="actual-party-card${poke.isShiny ? ' shiny' : ''}${poke.isDead ? ' dead' : ''}">
            <img src="${spriteUrl}" alt="${escapeHtml(poke.species)}" width="56" height="56" style="image-rendering:pixelated" onerror="this.src='${SPRITE_BASE}0.png'" />
            <div class="actual-party-info">
                <span class="actual-party-name">${escapeHtml(poke.nickname || poke.species)}</span>
                <span class="actual-party-level">Lv. ${poke.level}</span>
            </div>
        </div>`;
    }).join('');

    const deathsHTML = deaths.map(d => {
        const spriteUrl = getSpriteUrl(d.speciesId, d.isShiny);
        const date = new Date(d.diedAt);
        const timeStr = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        return `<div class="actual-death-card">
            <img src="${spriteUrl}" alt="${escapeHtml(d.species)}" width="48" height="48" style="image-rendering:pixelated" onerror="this.src='${SPRITE_BASE}0.png'" />
            <div class="actual-death-info">
                <span class="actual-death-name">${escapeHtml(d.nickname || d.species)}</span>
                <span class="actual-death-level">Lv. ${d.level}</span>
                <span class="actual-death-date">🕊️ ${timeStr}</span>
            </div>
        </div>`;
    }).join('');

    container.innerHTML = `
        <div class="actual-trainer-card">
            ${renderAvatarCircle('actual-trainer-avatar', initial, user.avatar_url)}
            <div class="actual-trainer-info">
                <div class="actual-trainer-name">${escapeHtml(trainerName)}</div>
                <div class="actual-trainer-meta">
                    <span>TID: ${tid}</span>
                    <span>🕐 ${hours}:${minutes}:${seconds}</span>
                </div>
                <div class="actual-trainer-money">💰 $${money}</div>
            </div>
        </div>

        <section class="detail-points-panel" style="padding: 20px 16px;">
            <div style="display: flex; gap: 20px; justify-content: center; align-items: stretch; flex-wrap: wrap;">
                <!-- Columna Izquierda: Puntos de Retos -->
                <div style="flex: 1; min-width: 180px; display: flex; flex-direction: column; justify-content: space-between;">
                    <div class="detail-points-header" style="margin-bottom: 6px;">
                        <span>🏆</span>
                        <span>Puntos de Retos (Web)</span>
                    </div>
                    <div class="detail-points-total" style="font-size: 2.2rem; margin-bottom: 6px;">${challengePoints}</div>
                    <div class="detail-points-badges" style="margin-bottom: 0;">
                        <span class="points-badge earned">+${displayEarned}</span>
                        ${displayDeaths > 0 ? `<span class="points-badge penalty">-${displayDeaths}</span>` : ''}
                    </div>
                </div>
                <!-- Separador -->
                <div style="width: 1px; background: rgba(0, 210, 255, 0.2); align-self: stretch;"></div>
                <!-- Columna Derecha: Puntos Disponibles -->
                <div style="flex: 1; min-width: 180px; display: flex; flex-direction: column; justify-content: space-between;">
                    <div class="detail-points-header" style="margin-bottom: 6px;">
                        <span>💰</span>
                        <span>Puntos Disponibles</span>
                    </div>
                    <div class="detail-points-total" style="font-size: 2.2rem; margin-bottom: 6px;">${spendablePoints}</div>
                    <div class="detail-points-badges" style="margin-bottom: 0;">
                        ${cardBonus > 0 ? `<span class="points-badge earned" style="background: rgba(140, 122, 230, 0.2); border-color: rgba(140, 122, 230, 0.4);">+${cardBonus} cartas</span>` : ''}
                        ${displaySpent > 0 ? `<span class="points-badge spent">-${displaySpent} gastados</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="detail-points-breakdown" style="margin-top: 14px; border-top: 1px solid rgba(0, 210, 255, 0.15); padding-top: 10px;">
                ${displayDeaths > 0 ? `<div class="detail-points-item penalty" style="display:inline-block; margin-right: 15px;">💀 Penalidad muertes: -${displayDeaths}</div>` : ''}
                ${displaySpent > 0 ? `<div class="detail-points-item spent" style="display:inline-block; margin-right: 15px;">🛒 Gastados en tienda: -${displaySpent}</div>` : ''}
                ${stats.shinys > 0 ? `<div class="detail-points-shiny" style="display:inline-block;">✨ Shinys encontrados: ${stats.shinys}</div>` : ''}
            </div>
        </section>

        <section class="actual-badges-section">
            <div class="section-title">
                <span class="icon">💎</span>
                <span>Cristales Z de Alola</span>
                <span class="count">${badgeCount}/${ALOLA_Z_CRYSTALS.length}</span>
            </div>
            <div class="badges-grid">${badgesHTML}</div>
        </section>

        <section class="actual-party-section">
            <div class="section-title">
                <span class="icon">⚔️</span>
                <span>Equipo</span>
                <span class="count">${party.length}/6</span>
            </div>
            <div class="actual-party-grid">${partyHTML || '<div class="no-data-msg"><span class="icon">🎒</span><p>Sin Pokémon en el equipo</p></div>'}</div>
        </section>

        ${deaths.length > 0 ? `
        <section class="actual-deaths-section">
            <div class="section-title">
                <span class="icon">💀</span>
                <span>Cementerio</span>
                <span class="count">${deaths.length}</span>
            </div>
            <div class="actual-deaths-grid">${deathsHTML}</div>
        </section>
        ` : ''}
    `;
}

// ===================== RENDER PARTY =====================

function renderDetailParty(party) {
    const grid = document.getElementById('detail-party-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (party.length === 0) {
        grid.innerHTML = '<div class="no-data-msg" style="grid-column:1/-1"><span class="icon">🎒</span><p>Sin Pokémon en el equipo</p></div>';
        return;
    }

    party.forEach(poke => {
        const card = document.createElement('div');
        const classes = ['pokemon-card'];
        if (poke.isShiny) classes.push('shiny');
        if (poke.isDead) classes.push('dead');
        card.className = classes.join(' ');

        const hpPercent = poke.stats && poke.stats.maxHP > 0
            ? Math.round((poke.stats.hp / poke.stats.maxHP) * 100)
            : 100;
        const hpClass = hpPercent > 50 ? 'hp-high' : hpPercent > 20 ? 'hp-mid' : 'hp-low';

        card.innerHTML = `
            <div class="card-header">
                <div class="sprite-container">
                    ${createSpriteImg(poke.speciesId, poke.isShiny, 68).outerHTML}
                </div>
                <div class="card-info">
                    <div class="name-row">
                        <span class="pokemon-name">${escapeHtml(poke.nickname)}</span>
                        ${poke.gender !== '—' ? `<span class="gender ${poke.gender === '♂' ? 'male' : 'female'}">${poke.gender}</span>` : ''}
                    </div>
                    ${poke.nickname !== poke.species ? `<div class="species-name">${escapeHtml(poke.species)}</div>` : ''}
                    <div class="level-badge">Lv. ${poke.level}</div>
                </div>
            </div>

            ${poke.stats ? `
            <div class="hp-bar-container">
                <div class="hp-label">
                    <span>HP</span>
                    <span>${poke.stats.hp} / ${poke.stats.maxHP}</span>
                </div>
                <div class="hp-bar">
                    <div class="hp-bar-fill ${hpClass}" style="width: ${hpPercent}%"></div>
                </div>
            </div>
            ` : ''}

            <div class="card-meta">
                <div class="meta-item"><span class="label">Naturaleza:</span> ${poke.nature}</div>
                <div class="meta-item"><span class="label">Habilidad:</span> ${escapeHtml(poke.ability)}</div>
                ${poke.heldItem !== '—' ? `<div class="meta-item"><span class="label">Objeto:</span> ${escapeHtml(poke.heldItem)}</div>` : ''}
            </div>

            <div class="moves-grid">
                ${(poke.moves || []).map(m => `<div class="move-tag">${escapeHtml(m.name)}</div>`).join('')}
            </div>

            <div class="stats-row">
                ${renderStatCell('HP', poke.stats ? poke.stats.maxHP : '?', poke.ivs.hp, poke.evs.hp)}
                ${renderStatCell('ATK', poke.stats ? poke.stats.atk : '?', poke.ivs.atk, poke.evs.atk)}
                ${renderStatCell('DEF', poke.stats ? poke.stats.def : '?', poke.ivs.def, poke.evs.def)}
                ${renderStatCell('SPA', poke.stats ? poke.stats.spa : '?', poke.ivs.spa, poke.evs.spa)}
                ${renderStatCell('SPD', poke.stats ? poke.stats.spd : '?', poke.ivs.spd, poke.evs.spd)}
                ${renderStatCell('SPE', poke.stats ? poke.stats.spe : '?', poke.ivs.spe, poke.evs.spe)}
            </div>
        `;

        grid.appendChild(card);
    });
}

function renderStatCell(label, value, iv, ev) {
    return `
        <div class="stat-item">
            <div class="stat-label">${label}</div>
            <div class="stat-val">${value}</div>
            <div class="iv-val ${iv === 31 ? 'perfect' : ''}">${iv} IV${ev > 0 ? ` / ${ev} EV` : ''}</div>
        </div>
    `;
}

// ===================== RENDER BOX =====================

function renderDetailBoxTabs(boxes) {
    const tabs = document.getElementById('detail-box-tabs');
    if (!tabs || !boxes) return;
    tabs.innerHTML = '';

    let totalPokemon = 0;
    boxes.forEach((box, i) => {
        const slots = box.slots || [];
        const filled = slots.filter(Boolean).length;
        totalPokemon += filled;

        const tab = document.createElement('button');
        tab.className = `box-tab${i === 0 ? ' active' : ''}`;
        tab.innerHTML = `Box ${i + 1}<span class="tab-count">${filled > 0 ? filled : ''}</span>`;
        tab.addEventListener('click', () => {
            document.querySelectorAll('#detail-box-tabs .box-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentBox = i;
            renderDetailBox(i, boxes);
        });
        tabs.appendChild(tab);
    });

    const totalEl = document.getElementById('detail-box-total');
    if (totalEl) totalEl.textContent = `${totalPokemon} Pokémon`;
}

function renderDetailBox(boxIndex, boxes) {
    const grid = document.getElementById('detail-box-grid');
    if (!grid || !boxes || !boxes[boxIndex]) return;

    const box = boxes[boxIndex];
    const slots = box.slots || [];
    grid.innerHTML = '';

    slots.forEach(poke => {
        const slot = document.createElement('div');
        if (poke) {
            const slotClasses = ['box-slot', 'occupied'];
            if (poke.isShiny) slotClasses.push('shiny');
            if (poke.isDead) slotClasses.push('dead');
            slot.className = slotClasses.join(' ');
            slot.innerHTML = `
                ${poke.isDead ? '<div class="death-marker">💀</div>' : ''}
                ${createSpriteImg(poke.speciesId, poke.isShiny, 56).outerHTML.replace('>', ' class="slot-sprite">')}
                <div class="slot-name">${escapeHtml(poke.nickname)}</div>
                ${poke.nickname !== poke.species ? `<div class="slot-species">${escapeHtml(poke.species)}</div>` : ''}
            `;
            slot.addEventListener('click', () => showModal(poke));
        } else {
            slot.className = 'box-slot empty';
            slot.innerHTML = `<div class="slot-sprite" style="width:56px;height:56px;opacity:0.1;display:flex;align-items:center;justify-content:center;font-size:1.5rem;">●</div>`;
        }
        grid.appendChild(slot);
    });
}

// ===================== GRAVEYARD =====================

function renderDetailGraveyard(nuzlocke) {
    const section = document.getElementById('detail-graveyard');
    const grid = document.getElementById('detail-graveyard-grid');
    if (!section || !grid) return;

    const deaths = nuzlocke.deaths || [];
    if (deaths.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    document.getElementById('detail-graveyard-count').textContent = deaths.length;
    grid.innerHTML = '';

    deaths.forEach(death => {
        const card = document.createElement('div');
        card.className = 'graveyard-card';
        const date = new Date(death.diedAt);
        const timeStr = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

        card.innerHTML = `
            <div class="grave-sprite">
                ${createSpriteImg(death.speciesId, death.isShiny, 56).outerHTML}
            </div>
            <div class="grave-info">
                <div class="grave-name">${escapeHtml(death.nickname || death.species)}</div>
                ${death.nickname && death.nickname !== death.species ? `<div class="grave-species">${escapeHtml(death.species)}</div>` : ''}
                <div class="grave-level">Lv. ${death.level}</div>
                <div class="grave-date">🕊️ ${timeStr}</div>
            </div>
        `;
        grid.appendChild(card);
    });
}

// ===================== TRAINER HAND CARDS =====================

function renderDetailCards(nuzlocke) {
    const section = document.getElementById('detail-cards');
    const grid = document.getElementById('detail-cards-grid');
    if (!section || !grid) return;

    const cards = (nuzlocke.cards && nuzlocke.cards.pulled) || [];
    const unusedCards = cards.filter(c => !c.usedAt);

    if (unusedCards.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    document.getElementById('detail-cards-count').textContent = unusedCards.length;
    grid.innerHTML = '';

    unusedCards.forEach(c => {
        const cardEl = document.createElement('div');
        cardEl.style.cssText = `
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid ${c.color || 'rgba(255,255,255,0.1)'}88;
            border-radius: 12px;
            padding: 10px 14px;
            width: calc(33% - 8px);
            min-width: 140px;
            box-sizing: border-box;
            display: flex;
            align-items: center;
            gap: 10px;
            position: relative;
            overflow: hidden;
            box-shadow: 0 4px 10px rgba(0,0,0,0.15);
        `;
        
        cardEl.innerHTML = `
            <div style="font-size: 1.6rem; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">${c.emoji || '🃏'}</div>
            <div style="flex-grow: 1; overflow: hidden; z-index: 1;">
                <div style="font-weight: 700; font-size: 0.85rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>
                <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">${escapeHtml(c.rarity || 'Común')}</div>
            </div>
            <div style="position: absolute; right: -15px; bottom: -15px; font-size: 3.5rem; opacity: 0.05; font-weight: 900; pointer-events: none;">${c.emoji || '🃏'}</div>
        `;
        grid.appendChild(cardEl);
    });
}

// ===================== MODAL =====================

function showModal(poke) {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');

    content.innerHTML = `
        <div style="position:relative">
            <button class="modal-close" onclick="closeModal()">✕</button>
            <div class="card-header">
                <div class="sprite-container">
                    ${createSpriteImg(poke.speciesId, poke.isShiny, 88).outerHTML}
                </div>
                <div class="card-info">
                    <div class="name-row">
                        <span class="pokemon-name">${escapeHtml(poke.nickname)}</span>
                        ${poke.gender !== '—' ? `<span class="gender ${poke.gender === '♂' ? 'male' : 'female'}">${poke.gender}</span>` : ''}
                        ${poke.isShiny ? '<span style="margin-left:4px">✨</span>' : ''}
                    </div>
                    ${poke.nickname !== poke.species ? `<div class="species-name">#${poke.speciesId} ${escapeHtml(poke.species)}</div>` : `<div class="species-name">#${poke.speciesId}</div>`}
                    ${poke.level > 0 ? `<div class="level-badge">Lv. ${poke.level}</div>` : ''}
                </div>
            </div>

            <div class="card-meta" style="margin: 16px 0">
                <div class="meta-item"><span class="label">Naturaleza:</span> ${poke.nature}</div>
                <div class="meta-item"><span class="label">Habilidad:</span> ${escapeHtml(poke.ability)}</div>
                ${poke.heldItem !== '—' ? `<div class="meta-item"><span class="label">Objeto:</span> ${escapeHtml(poke.heldItem)}</div>` : ''}
                ${poke.otName ? `<div class="meta-item"><span class="label">OT:</span> ${escapeHtml(poke.otName)}</div>` : ''}
            </div>

            <div style="margin-bottom:16px">
                <div style="font-size:0.78rem;font-weight:600;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">Movimientos</div>
                <div class="moves-grid">
                    ${(poke.moves || []).map(m => `<div class="move-tag">${escapeHtml(m.name)} <span style="opacity:0.5;font-size:0.65rem">${m.pp}PP</span></div>`).join('')}
                </div>
            </div>

            <div style="margin-bottom:16px">
                <div style="font-size:0.78rem;font-weight:600;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">IVs</div>
                <div class="stats-row">
                    ${['hp','atk','def','spa','spd','spe'].map(stat =>
                        `<div class="stat-item">
                            <div class="stat-label">${stat.toUpperCase()}</div>
                            <div class="stat-val ${poke.ivs[stat] === 31 ? 'perfect' : ''}" style="${poke.ivs[stat] === 31 ? 'color:var(--accent-gold)' : ''}">${poke.ivs[stat]}</div>
                        </div>`
                    ).join('')}
                </div>
            </div>

            <div>
                <div style="font-size:0.78rem;font-weight:600;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">EVs</div>
                <div class="stats-row">
                    ${['hp','atk','def','spa','spd','spe'].map(stat =>
                        `<div class="stat-item">
                            <div class="stat-label">${stat.toUpperCase()}</div>
                            <div class="stat-val">${poke.evs[stat]}</div>
                        </div>`
                    ).join('')}
                </div>
            </div>
        </div>
    `;

    overlay.classList.add('visible');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.remove('visible');
}

// ===================== HELPERS =====================

function getSpriteUrl(speciesId, isShiny) {
    return `${isShiny ? SPRITE_SHINY_BASE : SPRITE_BASE}${speciesId}.png`;
}

function createSpriteImg(speciesId, isShiny, size = 68) {
    const img = document.createElement('img');
    img.src = getSpriteUrl(speciesId, isShiny);
    img.alt = '';
    img.width = size;
    img.height = size;
    img.style.imageRendering = 'pixelated';
    img.onerror = () => { img.src = `${SPRITE_BASE}0.png`; };
    return img;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===================== KALOS LOCATION NAMES (PKHeX XY es) =====================

// Location ID → Spanish name from PKHeX text_xy_00000_es.txt
// IDs = 0-based line index in the file (confirmed with save data)
const ALOLA_LOCATIONS = {
    0: '——————',
    2: 'Zona misteriosa',
    4: 'Lugar lejano',
    6: 'Ruta 1',
    7: "Ruta 1 (Afueras de Hau'oli)",
    8: 'Ruta 1',
    10: 'Ruta 3',
    12: 'Ruta 2',
    14: "Bahía de Kala'e",
    16: 'Mar de Melemele',
    18: "Ciudad de Hau'oli",
    19: "Ciudad de Hau'oli (Frente a la playa)",
    20: "Ciudad de Hau'oli",
    21: "Ciudad de Hau'oli (Distrito comercial)",
    22: "Ciudad de Hau'oli",
    23: "Ciudad de Hau'oli (Puerto pequeño)",
    24: 'Pueblo Iki',
    26: 'Sendero Mahalo',
    28: 'Sendero Mahalo',
    29: 'Sendero Mahalo (Puente de tablones)',
    30: 'Ruinas del Conflicto',
    32: 'Ruinas del Conflicto',
    34: 'Colina Deztellos',
    36: 'Colina Deztellos',
    37: 'Colina Deztellos (Hueco más lejano)',
    38: "Cementerio de Hau'oli",
    40: 'Prado de Melemele',
    42: 'Cueva del Embarcadero',
    44: 'Huerto de Bayas',
    46: 'Caverna Verde',
    47: 'Caverna Verde (Sitio de prueba)',
    48: 'Caverna Verde',
    49: 'Caverna Verde (La guarida del tótem)',
    50: 'Ruta 4',
    52: 'Ruta 5',
    54: 'Ruta 6',
    56: 'Ruta 7',
    58: 'Ruta 8',
    60: 'Ruta 9',
    62: 'Gran Hotel de Hano',
    64: 'Playa de Hano',
    66: 'Prado de Akala',
    68: 'Pueblo Paniola',
    70: 'Ciudad Heahea',
    72: 'Ciudad Konikoni',
    74: 'Avenida Real',
    76: 'Colina del Recuerdo',
    78: 'Rancho Paniola',
    82: 'Área Volcánica de Wela',
    84: 'Área Volcánica de Wela',
    85: 'Área Volcánica de Wela (La guarida del tótem)',
    86: 'Colina Saltagua',
    88: 'Colina Saltagua',
    89: 'Colina Saltagua (La guarida del tótem)',
    90: 'Jungla Umbría',
    92: 'Ruinas de la Vida',
    94: 'Afueras de Akala',
    100: 'Túnel Diglett',
    102: 'Gran Hotel de Hano',
    104: 'Estadio Royale',
    106: 'Ruta 10',
    108: 'Ruta 11',
    110: "Playa Ula'ula",
    112: 'Ruta 13',
    114: 'Pueblo Tapu',
    116: 'Ruta 15',
    118: 'Ruta 16',
    120: 'Ruta 17',
    122: 'Ruta 12',
    124: 'Desierto de Haina',
    126: 'Ruta 14',
    128: 'Prado de Ula-ula',
    130: 'Pueblo Po',
    132: 'Ciudad Malíe',
    134: 'Jardines de Malíe',
    136: 'Monte Hokulani',
    138: 'Pico del Hospicio',
    140: 'Ruinas de la Cosecha',
    142: 'Lago Solsubiri',
    144: 'Lago Lunalae',
    146: 'Monte Lanakila',
    148: 'Mansión Lúgubre',
    150: 'Supermercado Gangas',
    151: 'Supermercado Gangas (Edificio abandonado)',
    152: 'Observatorio de Hokulani',
    154: 'Liga Pokémon',
    156: 'Prado de Poni',
    158: 'Llanura de Poni',
    160: 'Antiguo Paso de Poni',
    162: 'Arrecife de Poni',
    164: 'Bosque de Poni',
    166: 'Llanuras de Poni',
    168: 'Costa de Poni',
    170: 'Desfiladero de Poni',
    172: 'Aldea Marina',
    174: 'Cañón de Poni',
    176: 'Altar del Sol',
    178: 'Altar de la Luna',
    180: 'Ruinas del Tránsito',
    182: 'Cueva de la Resolución',
    184: 'Isla Exeggutor',
    186: 'Árbol de Batalla',
    188: 'Paraíso Aether',
    190: 'Mar Ultraprofundo',
    192: 'Ciudad Malíe',
    193: 'Ciudad Malíe (Cabo de la Tienda)',
    194: 'Melemele',
    195: 'Akala',
    196: "Ula'ula",
    197: 'Poni',
    198: 'Playa de Olas Grandes',
    200: 'Cueva Arenosa',
    202: 'Playa de Heahea',
    204: 'Playa de Poni',
    206: 'Ultra Megalópolis',
    208: 'Torre Megalópolis',
    210: 'Planta Ultra',
    212: 'Cráter Ultra',
    214: 'Desierto Ultra',
    216: 'Bosque Ultra',
    218: 'Jungla Ultra',
    220: 'Ruinas Ultra',
    222: 'Ultra Space Wilds',
    224: 'Castillo del Team Rainbow Rocket',
    226: 'Gruta de las Llanuras',
    228: 'Valle de los Pikachu',
    230: 'Ruta 1',
    231: 'Ruta 1 (Escuela de Entrenadores)',
    232: 'Túnel de la Cima Divisoria',
    30001: 'un intercambio de enlaces',
    30002: 'un intercambio de enlaces',
    30003: 'la región de Kanto',
    30004: 'la región de Johto',
    30005: 'la región de Hoenn',
    30006: 'la región de Sinnoh',
    30007: 'una tierra lejana',
    30009: 'la región de Teselia',
    30010: 'la región de Kalos',
    30011: 'Pokémon Link',
    30012: 'Pokémon GO',
    30013: 'la región de Kanto',
    30014: 'la región de Hoenn',
    30015: 'la región de Alola',
    30016: 'Poké Pelago',
    30017: 'la región de Johto',
    40001: 'un lugar encantador',
    40002: 'un lugar lejano',
    40003: 'una película de Pokémon',
    40004: 'Película de Pokémon de 2016',
    40005: 'Película de Pokémon de 2017',
    40006: 'Película de Pokémon de 2018',
    40007: 'Película de Pokémon de 2019',
    40008: 'Película de Pokémon de 2020',
    40009: 'Película de Pokémon de 2021',
    40010: 'un Centro Pokémon',
    40011: 'La serie animada de Pokémon',
    40012: 'Centro Pokémon MEGA TOKIO',
    40013: "Centro Pokémon de Osaka",
    40014: "Centro Pokémon de Fukuoka",
    40015: "Centro Pokémon de Nagoya",
    40016: "Centro Pokémon de Sapporo",
    40017: "Centro Pokémon de Yokohama",
    40018: "Centro Pokémon de Tohoku",
    40019: "Centro Pokémon de Tokio-Bahía",
    40020: "Centro Pokémon de Hiroshima",
    40021: "Centro Pokémon de Kioto",
    40022: "Centro Pokémon de Ciudad Árbol",
    40023: 'una tienda Pokémon',
    40024: 'un WCS',
    40025: 'WCS 2016',
    40026: 'WCS 2017',
    40027: 'WCS 2018',
    40028: 'WCS 2019',
    40029: 'WCS 2020',
    40030: 'WCS 2021',
    40031: 'Mundos',
    40032: 'Campeonato Mundial 2016',
    40033: 'Campeonato Mundial 2017',
    40034: 'Campeonato Mundial 2018',
    40035: 'Campeonato Mundial 2019',
    40036: 'Mundiales 2020',
    40037: 'Mundiales 2021',
    40038: 'un VGE',
    40039: 'VGE 2016',
    40040: 'VGE 2017',
    40041: 'VGE 2018',
    40042: 'VGE 2019',
    40043: 'VGE 2020',
    40044: 'VGE 2021',
    40045: 'un evento de Pokémon',
    40046: 'una competición de batalla',
    40047: 'un evento de juego',
    40048: 'el Club Pokémon Daisuki',
    40049: 'un programa de televisión de Pokémon',
    40050: 'un concierto',
    40051: 'un regalo en línea',
    40052: 'el PGL',
    40053: 'un evento de Pokémon de 2016',
    40054: 'un evento de Pokémon de 2017',
    40055: 'un evento de Pokémon de 2018',
    40056: 'un evento de Pokémon de 2019',
    40057: 'un evento de Pokémon de 2020',
    40058: 'un evento de Pokémon de 2021',
    40059: 'un evento de Pokémon',
    40060: 'un evento de Pokémon de 2016',
    40061: 'un evento de Pokémon de 2017',
    40062: 'un evento de Pokémon de 2018',
    40063: 'un evento de Pokémon de 2019',
    40064: 'un evento de Pokémon de 2020',
    40065: 'un evento de Pokémon de 2021',
    40066: 'Parque Pokémon',
    40067: 'Parque Pokémon 2016',
    40068: 'PokéPark 2017',
    40069: 'PokéPark 2018',
    40070: 'PokéPark 2019',
    40071: 'PokéPark 2020',
    40072: 'PokéPark 2021',
    40073: 'un sitio para eventos',
    40074: 'GAME FREAK',
    40075: 'un estadio',
    40076: 'VGC',
    40077: 'el VGC 2016',
    40078: 'el VGC 2017',
    40079: 'el VGC 2018',
    40080: 'el VGC 2019',
    40081: 'el VGC 2020',
    40082: 'el VGC 2021',
    40083: 'un juego de la Consola Virtual',
    40084: 'Pokémon GO',
    40085: 'Banco Pokémon',
    40086: 'una tienda Pokémon',
    40087: 'una versión de demostración',
    40088: 'El Club de Entrenadores Pokémon',
    60001: 'un desconocido',
    60002: 'Ayudantes de guardería',
    60003: 'un cazador de tesoros',
    60004: 'un antiguo visitante de aguas termales'
};

const LOCATION_DISPLAY = {
    36: { name: '🎰 Gacha', sub: 'Pokémon obtenido por gacha' },
    154: { name: '🏆 Liga Pokémon', sub: 'Pokémon League' },
    188: { name: '🏢 Paraíso Aether', sub: 'Aether Paradise' },
    186: { name: '🌲 Árbol de Batalla', sub: 'Battle Tree' },
    206: { name: '🏙️ Ultra Megalópolis', sub: 'Alola' },
    228: { name: '⚡ Valle de los Pikachu', sub: 'Pikachu Valley' }
};

// ===================== ROUTES TAB =====================

// Persisted state for routes tab
let _routeMap = {};         // locationId → [{ pokemon, username, initial, avatarUrl }]
let _routeValidIds = [];    // sorted, valid location IDs
let _openRoutes = new Set(); // which route locIds are expanded
let _routeFilter = 'all';    // username filter, 'all' = show everyone

function renderRoutes() {
    const container = document.getElementById('routes-container');
    const countEl = document.getElementById('routes-count');
    if (!container) return;

    // Collect ALL pokemon from ALL users
    _routeMap = {};
    const trainerNames = new Set();

    allUsers.forEach(user => {
        const username = user.username || 'Unknown';
        const initial = username.charAt(0).toUpperCase();
        const party = user.party || [];
        const boxes = user.boxes || [];
        trainerNames.add(username);

        const addPoke = (poke) => {
            if (!poke || poke.isEgg) return;
            const locId = poke.metLocation || 0;
            if (!_routeMap[locId]) _routeMap[locId] = [];
            _routeMap[locId].push({ pokemon: poke, username, initial, avatarUrl: user.avatar_url || null });
        };

        party.forEach(addPoke);
        boxes.forEach(box => (box.slots || []).forEach(addPoke));
    });

    // Sort location IDs in game order, filter out 0
    const locationIds = Object.keys(_routeMap).map(Number).sort((a, b) => a - b);
    _routeValidIds = locationIds.filter(id => id > 0);

    if (countEl) countEl.textContent = _routeValidIds.length;

    if (_routeValidIds.length === 0) {
        container.innerHTML = `
            <div class="no-data-msg"><span class="icon">🗺️</span><p>Sin datos de rutas aún</p></div>
        `;
        return;
    }

    // Build trainer filter bar
    let filterHTML = `<div class="routes-filter-bar">
        <span class="routes-filter-label">🔍 Entrenador:</span>
        <div class="routes-filter-pills">
            <button class="route-filter-pill active" data-trainer="all" onclick="applyRouteFilter('all')">Todos</button>`;
    [...trainerNames].sort().forEach(name => {
        filterHTML += `<button class="route-filter-pill" data-trainer="${escapeHtml(name)}" onclick="applyRouteFilter('${escapeHtml(name)}')">${escapeHtml(name)}</button>`;
    });
    filterHTML += `</div></div>`;

    container.innerHTML = filterHTML;
    _routeFilter = 'all';

    // Render route boxes
    _routeValidIds.forEach(locId => {
        container.appendChild(_buildRouteBox(locId));
    });
}

function _buildRouteBox(locId) {
    const allEntries = _routeMap[locId] || [];
    const entries = _routeFilter === 'all'
        ? allEntries
        : allEntries.filter(e => e.username === _routeFilter);

    const display = LOCATION_DISPLAY[locId];
    const locName = display ? display.name : (ALOLA_LOCATIONS[locId] || `Ubicación #${locId}`);
    const locSub = display ? display.sub : '';
    const isOpen = _openRoutes.has(locId);
    const isHidden = entries.length === 0;

    const routeBox = document.createElement('div');
    routeBox.className = 'route-box' + (isHidden ? ' route-box-hidden' : '');
    routeBox.id = `route-box-${locId}`;

    // Header (always visible, acts as toggle)
    const headerHTML = `
        <div class="route-header route-header-toggle" onclick="toggleRoute(${locId})">
            <div class="route-chevron${isOpen ? ' open' : ''}">▶</div>
            <div class="route-title">${locName}</div>
            ${locSub ? `<div class="route-sub">${locSub}</div>` : ''}
            <span class="route-count">${entries.length}</span>
        </div>
    `;

    // Grid (collapsed by default)
    let slotsHTML = `<div class="route-grid-wrap${isOpen ? ' open' : ''}">`;
    slotsHTML += '<div class="route-grid">';
    entries.forEach(entry => {
        const p = entry.pokemon;
        const spriteUrl = getSpriteUrl(p.speciesId, p.isShiny);
        const badgeContent = entry.avatarUrl
            ? `<img src="${entry.avatarUrl}" class="avatar-circle-img" alt="" onerror="this.parentNode.textContent='${escapeHtml(entry.initial)}'">` 
            : entry.initial;
        slotsHTML += `
            <div class="route-pokemon${p.isShiny ? ' shiny' : ''}" title="${escapeHtml(p.nickname || p.species)} Lv.${p.level} — ${escapeHtml(entry.username)}">
                <div class="route-trainer-badge">${badgeContent}</div>
                <img src="${spriteUrl}" alt="${escapeHtml(p.species)}" width="56" height="56" style="image-rendering:pixelated" onerror="this.src='${SPRITE_BASE}0.png'" loading="lazy" />
                <div class="route-poke-name">${escapeHtml(p.nickname || p.species)}</div>
                <div class="route-poke-level">Lv.${p.level || '?'}</div>
            </div>
        `;
    });
    slotsHTML += '</div></div>';

    routeBox.innerHTML = headerHTML + slotsHTML;
    return routeBox;
}

function toggleRoute(locId) {
    if (_openRoutes.has(locId)) {
        _openRoutes.delete(locId);
    } else {
        _openRoutes.add(locId);
    }
    // Re-render just this box
    const existing = document.getElementById(`route-box-${locId}`);
    if (existing) {
        const newBox = _buildRouteBox(locId);
        existing.replaceWith(newBox);
    }
}

function applyRouteFilter(trainer) {
    _routeFilter = trainer;

    // Update pill active states
    document.querySelectorAll('.route-filter-pill').forEach(pill => {
        pill.classList.toggle('active', pill.dataset.trainer === trainer);
    });

    // Re-render all route boxes
    _routeValidIds.forEach(locId => {
        const existing = document.getElementById(`route-box-${locId}`);
        if (existing) {
            const newBox = _buildRouteBox(locId);
            existing.replaceWith(newBox);
        }
    });
}

// ===================== LEAGUE TABS =====================

function switchLeagueTab(tabName) {
    document.querySelectorAll('.league-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.league-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabName}`);
    });
}

// ===================== RANKINGS =====================

function getTrainerStats(user) {
    const party = user.party || [];
    const boxes = user.boxes || [];
    const nuzlocke = user.nuzlocke || { deaths: [] };
    const deaths = nuzlocke.deaths ? nuzlocke.deaths.length : 0;
    const trainer = user.trainer || {};
    const badges = trainer.badgeCount || 0;

    // Count unique species
    const speciesSet = new Set();
    party.forEach(p => { if (p && p.speciesId) speciesSet.add(p.speciesId); });
    boxes.forEach(b => (b.slots || []).forEach(p => { if (p && p.speciesId) speciesSet.add(p.speciesId); }));
    const uniqueSpecies = speciesSet.size;

    // Count shinys
    let shinys = 0;
    const shinyList = [];
    party.forEach(p => { if (p && p.isShiny) { shinys++; shinyList.push(p); } });
    boxes.forEach(b => (b.slots || []).forEach(p => { if (p && p.isShiny) { shinys++; shinyList.push(p); } }));

    // Points: use pre-computed value from server if available, fallback to badges*100 - deaths*50
    let points = badges * 100;
    points -= deaths * 50;
    return { deaths, badges, uniqueSpecies, shinys, shinyList, points, deathList: nuzlocke.deaths || [] };
}

// ===================== RANKING SUB-TABS =====================

let activeRankingTab = 'points';

function switchRankingTab(tab) {
    activeRankingTab = tab;
    document.querySelectorAll('.ranking-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.rtab === tab);
    });
    document.querySelectorAll('.ranking-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `rpanel-${tab}`);
    });
}

// ===================== RANKINGS =====================

function renderRankings() {
    if (!allUsers || allUsers.length === 0) return;

    const stats = allUsers.map(user => {
        const ts = getTrainerStats(user);
        const pts = getNuzlockePointsDisplay(user, ts.deaths);
        return {
            user,
            ...ts,
            displayPoints: pts.displayPoints,
            challengePoints: pts.challengePoints,
            spendablePoints: pts.spendablePoints,
        };
    });

    // Get logged-in username from localStorage (set by auth)
    const loggedUsername = localStorage.getItem('username') || null;

    buildRankingCategory(
        'ranking-points',
        [...stats].sort((a, b) => b.challengePoints - a.challengePoints),
        s => s.challengePoints,
        (v, s) => `${v} pts (${s.spendablePoints} disp.)`,
        loggedUsername,
        'puntos'
    );

    buildRankingCategory(
        'ranking-deaths',
        [...stats].sort((a, b) => b.deaths - a.deaths),
        s => s.deaths,
        v => `${v} 💀`,
        loggedUsername,
        'muertes'
    );

    buildRankingCategory(
        'ranking-shinys',
        [...stats].sort((a, b) => b.shinys - a.shinys),
        s => s.shinys,
        v => `${v} ✨`,
        loggedUsername,
        'shinys'
    );
}

/**
 * Build a full ranking panel: podium (top 3) + list (4–10) + user position footer.
 * @param {string} containerId  - The element id to render into
 * @param {Array}  sorted       - Stats array sorted by the category descending
 * @param {Function} getValue   - (statEntry) => numeric value
 * @param {Function} formatVal  - (value) => display string
 * @param {string|null} loggedUsername
 * @param {string} unitLabel    - 'puntos' | 'muertes' | 'shinys'
 */
function buildRankingCategory(containerId, sorted, getValue, formatVal, loggedUsername, unitLabel) {
    const el = document.getElementById(containerId);
    if (!el) return;

    // Assign ranks (shared on tie)
    const ranked = [];
    let rank = 1;
    sorted.forEach((s, i) => {
        if (i > 0 && getValue(s) !== getValue(sorted[i - 1])) {
            rank = i + 1;
        }
        ranked.push({ ...s, rank });
    });

    const top10 = ranked.slice(0, 10);
    const loggedEntry = loggedUsername
        ? ranked.find(r => r.user.username.toLowerCase() === loggedUsername.toLowerCase())
        : null;
    const loggedInTop10 = loggedEntry ? top10.some(r => r.user.id === loggedEntry.user.id) : false;

    // ---- PODIUM (top 3) ----
    // Build slots with metadata BEFORE filtering so pos/medal don't shift
    const podiumSlots = [
        { entry: top10[1], pos: 'silver', medal: '🥈', size: 64 },
        { entry: top10[0], pos: 'gold',   medal: '🥇', size: 80 },
        { entry: top10[2], pos: 'bronze', medal: '🥉', size: 64 },
    ].filter(s => s.entry);

    function avatarHTML(entry, size, cls) {
        const initial = entry.user.username.charAt(0).toUpperCase();
        const url = entry.user.avatar_url;
        if (url) {
            return `<div class="podium-avatar ${cls}" style="width:${size}px;height:${size}px"><img src="${url}" class="avatar-circle-img" alt="${escapeHtml(initial)}" onerror="this.parentNode.textContent='${escapeHtml(initial)}'"></div>`;
        }
        return `<div class="podium-avatar ${cls}" style="width:${size}px;height:${size}px">${escapeHtml(initial)}</div>`;
    }

    const isLogged = (entry) => loggedUsername && entry.user.username.toLowerCase() === loggedUsername.toLowerCase();

    let podiumHTML = '<div class="podium-container">';
    podiumSlots.forEach(({ entry, pos, medal, size }) => {
        const highlight = isLogged(entry) ? ' podium-logged' : '';
        podiumHTML += `
            <div class="podium-slot ${pos}${highlight}">
                ${avatarHTML(entry, size, `podium-avatar-${pos}`)}
                <div class="podium-medal">${medal}</div>
                <div class="podium-name">${escapeHtml(entry.user.username)}</div>
                <div class="podium-value">${formatVal(getValue(entry), entry)}</div>
                <div class="podium-rank-bar ${pos}"></div>
            </div>
        `;
    });
    podiumHTML += '</div>';

    // ---- TOP 10 LIST (positions 4-10) ----
    const listEntries = top10.slice(3);
    let listHTML = '';
    if (listEntries.length > 0) {
        listHTML = '<div class="ranking-list-top10">';
        listEntries.forEach(entry => {
            const highlight = isLogged(entry) ? ' ranking-row-logged' : '';
            const initial = entry.user.username.charAt(0).toUpperCase();
            const url = entry.user.avatar_url;
            const avatarEl = url
                ? `<div class="rank-avatar"><img src="${url}" class="avatar-circle-img" alt="${escapeHtml(initial)}" onerror="this.parentNode.textContent='${escapeHtml(initial)}'"></div>`
                : `<div class="rank-avatar">${escapeHtml(initial)}</div>`;
            listHTML += `
                <div class="ranking-row${highlight}">
                    <span class="rank-pos">#${entry.rank}</span>
                    ${avatarEl}
                    <span class="rank-name">${escapeHtml(entry.user.username)}</span>
                    <span class="rank-value">${formatVal(getValue(entry), entry)}</span>
                </div>
            `;
        });
        listHTML += '</div>';
    }

    // ---- USER POSITION FOOTER (if not in top 10) ----
    let footerHTML = '';
    if (loggedEntry && !loggedInTop10) {
        footerHTML = `
            <div class="ranking-user-footer">
                <span class="ranking-user-footer-icon">🎖️</span>
                <span>Tú estás <strong>top ${loggedEntry.rank}</strong> con <strong>${formatVal(getValue(loggedEntry), loggedEntry)}</strong> ${unitLabel}</span>
            </div>
        `;
    }

    el.innerHTML = podiumHTML + listHTML + footerHTML;
}

// ===================== INFO TAB =====================

let activeInfoTab = 'gym-leaders';

function switchInfoTab(tab) {
    activeInfoTab = tab;
    document.querySelectorAll('.info-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.itab === tab);
    });
    document.querySelectorAll('.info-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `ipanel-${tab}`);
    });
}

// ===================== GYM LEADERS =====================

const GYM_LEADERS = [
    { num: 1,  name: 'Totem Normastal',     gym: 'Prueba Normal (Liam)',    level: 14, badgeName: 'Normastal Z' },
    { num: 2,  name: 'Kaudan (Kahuna)',     gym: 'Gran Prueba Lucha',       level: 19, badgeName: 'Lizastal Z' },
    { num: 3,  name: 'Totem Hidrostal',     gym: 'Prueba Agua (Nereida)',   level: 24, badgeName: 'Hidrostal Z' },
    { num: 4,  name: 'Totem Pirostal',      gym: 'Prueba Fuego (Kiawe)',    level: 26, badgeName: 'Pirostal Z' },
    { num: 5,  name: 'Totem Fitostal',      gym: 'Prueba Planta (Lulú)',    level: 29, badgeName: 'Fitostal Z' },
    { num: 6,  name: 'Mayla (Kahuna)',      gym: 'Gran Prueba Roca',        level: 34, badgeName: 'Litostal Z' },
    { num: 7,  name: 'Totem Electrostal',   gym: 'Prueba Eléctrico (Chris)',level: 40, badgeName: 'Electrostal Z' },
    { num: 8,  name: 'Totem Espectrostal',  gym: 'Prueba Fantasma (Zarala)',level: 42, badgeName: 'Espectrostal Z' },
    { num: 9,  name: 'Denio (Kahuna)',      gym: 'Gran Prueba Siniestro',   level: 53, badgeName: 'Nictostal Z' },
    { num: 10, name: 'Totem Dracostal',     gym: 'Prueba Dragón (Cañón)',   level: 59, badgeName: 'Dracostal Z' },
    { num: 11, name: 'Prueba de Rika',      gym: 'Entrenadores Pétalos: Lv. 61 / Dominante: Lv. 66', level: '61 / 66', badgeName: 'Feeristal Z' },
    { num: 12, name: 'Hela (Kahuna)',       gym: 'Gran Prueba Tierra',      level: 65, badgeName: 'Geostal Z' }
];

const ELITE_FOUR = [
    {
        num: 'E4',
        name: 'Molayne / Olivia / Zarala / Kahili',
        gym: 'Alto Mando Alola',
        icon: '⚔️',
        level: 68,
        isElite: true,
    },
    {
        num: 'C',
        name: 'Combate de Campeón (Hau)',
        gym: 'Defensa del Título',
        icon: '🏆',
        level: 71,
        isChampion: true,
    },
];

const RETOS_TEAM_SKULL = [
    { name: 'Playa Big Wave (Mantine)', desc: 'Ayuda al Mantine de los secuaces del Team Skull', level: '-' },
    { name: 'Ruta 6 (Reclutas)', desc: 'Ayudar a Hela venciendo a los reclutas del Team Skull', level: '-' },
    { name: 'Túnel Diglett (Reclutas)', desc: 'Aliate con Tilo para vencer a los reclutas del Team Skull', level: '-' },
    { name: 'Colina Recuerdo (Reclutas)', desc: 'Ayuda al Slowpoke venciendo a los reclutas del Team Skull', level: '-' },
    { name: 'Francine (Afueras de Alola)', desc: 'Vence a Francine en las afueras de Alola', level: 32 },
    { name: 'Ruta 10 (Reclutas Parada Bus)', desc: 'Vence a los reclutas del Team Skull en la parada del bus', level: '-' },
    { name: 'Guzmán (Parque de Malíe)', desc: 'Vence a Guzmán en el parque de Malíe', level: 41 },
    { name: 'Ruta 15 (Salvar a Lylia)', desc: 'Salva a Lylia del recluta del Team Skull', level: '-' },
    { name: 'Francine (Ruta 15)', desc: 'Vence a Francine en la ruta 15', level: 46 },
    { name: 'Guzmán (Pueblo Po)', desc: 'Vence a Guzmán en pueblo Po', level: 49 },
    { name: 'Paso de Poni (Reclutas)', desc: 'Vence a los reclutas del Team Skull en el antiguo paso de Poni', level: '-' }
];

const RETOS_AETHER = [
    { name: 'Director Fabio (Puerto)', desc: 'Vence al Director Fabio al subir por el ascensor desde el puerto', level: '-' },
    { name: 'Director Fabio & Tilo (Exterior)', desc: 'Vence al Director Fabio junto a Tilo para salir al exterior', level: 54 },
    { name: 'Guzmán (Exterior)', desc: 'Vence a Guzmán en el exterior', level: 54 },
    { name: 'Samina (Laboratorio)', desc: 'Vence a Samina en su laboratorio', level: 56 }
];

const RETOS_RIVALES = [
    { name: 'Tilo (Ruta 3)', desc: 'Combate contra Tilo en la ruta 3', level: 16 },
    { name: 'Dexio (Ciudad Kentai)', desc: 'Combate contra Dexio en ciudad Kentai', level: 19 },
    { name: 'Tilo (Pueblo Ohana)', desc: 'Combate contra Tilo en pueblo Ohana', level: 19 },
    { name: 'Gladio (Ruta 5)', desc: 'Combate contra Gladio en la ruta 5', level: 22 },
    { name: 'Tilo (Ciudad Malíe)', desc: 'Combate contra Tilo en Ciudad Malíe', level: 36 },
    { name: 'Gladio (Ruta 15)', desc: 'Combate contra Gladio en la ruta 15', level: 52 },
    { name: 'Gladio (Monte Lanakila)', desc: 'Combate contra Gladio en el inicio del monte Lanakila', level: 66 }
];

const RETOS_UNIDAD_ULTRA = [
    { name: 'Darius (Cueva Unemar)', desc: 'Combate contra Darius en la cueva Unemar', level: 16 },
    { name: 'Darius (Rancho Ohana)', desc: 'Combate en Rancho Ohana tras quitar los Sudowoodo', level: 24 },
    { name: 'Nihilego Dominante (Paraíso)', desc: 'Combate contra Nihilego dominante en el Paraíso Aether', level: 32 },
    { name: 'Darius (Paraíso Aether)', desc: 'Combate antes de entrar a la habitación de Samina contra Darius', level: 56 },
    { name: 'Darius (Cañón de Poni)', desc: 'Combate contra Darius en el cañón de Poni', level: 59 },
    { name: 'Ultra Necrozma (Torre)', desc: 'Combate contra Ultra Necrozma en la Torre Ultrópolis', level: '-' }
];

const RETOS_RAINBOW_ROCKET = [
    { name: 'Primeros Entrenadores (Castillo)', desc: 'Primeros combates del episodio Rainbow Rocket', level: 73 },
    { name: 'Fabio (Entrada Castillo)', desc: 'Vence a Fabio en la entrada del castillo Rocket', level: 76 },
    { name: 'Aquiles (Castillo Rocket)', desc: 'Vence a Aquiles en el castillo Rocket', level: 79 },
    { name: 'Magno (Castillo Rocket)', desc: 'Vence a Magno en el castillo Rocket', level: 79 },
    { name: 'Helio (Castillo Rocket)', desc: 'Vence a Helio en el castillo Rocket', level: 80 },
    { name: 'Lysson (Castillo Rocket)', desc: 'Vence a Lysson en el castillo Rocket', level: 80 },
    { name: 'Gechis (Castillo Rocket)', desc: 'Vence a Gechis en el castillo Rocket', level: 82 },
    { name: 'Giovanni (Castillo Rocket)', desc: 'Vence a Giovanni en el castillo Rocket', level: 84 }
];

function renderGymLeaders() {
    const container = document.getElementById('gym-leaders-content');
    if (!container) return;

    let html = '';

    // Gym leaders title
    html += `
        <div class="gym-leaders-header">
            <div class="section-title"><span class="icon">🏝️</span><span>Pruebas y Kahunas de Alola</span></div>
        </div>
        <div class="gym-leaders-grid">
    `;

    GYM_LEADERS.forEach(leader => {
        const z = ALOLA_Z_CRYSTALS.find(x => x.name === leader.badgeName);
        const svgContent = z ? getZCrystalSVG(z.colors, z.glow, z.symbol, z.name) : '';
        html += `
            <div class="gym-leader-card">
                <div class="gym-leader-num">#${leader.num}</div>
                <div class="gym-leader-badge-wrap" style="position: relative;">
                    ${z ? `<img src="${z.img}" class="gym-leader-badge-img" style="display: none; width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 0 8px ${z.glow})" onload="this.style.display='block'; this.nextElementSibling.style.display='none';" />` : ''}
                    <div style="width: 100%; height: 100%;">${svgContent}</div>
                </div>
                <div class="gym-leader-info">
                    <div class="gym-leader-name">${escapeHtml(leader.name)}</div>
                    <div class="gym-leader-gym">${escapeHtml(leader.gym)}</div>
                </div>
                <div class="gym-leader-level">
                    <span class="gym-level-label">Nivel</span>
                    <span class="gym-level-value">${leader.level}</span>
                </div>
            </div>
        `;
    });

    html += '</div>';

    // Elite Four & Champion
    html += `
        <div class="gym-leaders-header" style="margin-top:40px">
            <div class="section-title"><span class="icon">👑</span><span>Alto Mando y Defensor</span></div>
        </div>
        <div class="gym-leaders-grid gym-elite-grid">
    `;

    ELITE_FOUR.forEach(entry => {
        const cardClass = entry.isChampion ? 'gym-leader-card gym-champion-card' : 'gym-leader-card gym-elite-card';
        html += `
            <div class="${cardClass}">
                <div class="gym-leader-num${entry.isChampion ? ' champion-num' : ' elite-num'}">${entry.isChampion ? '👑' : '⚔️'}</div>
                <div class="gym-leader-badge-wrap">
                    <div class="gym-leader-no-badge">${entry.icon}</div>
                </div>
                <div class="gym-leader-info">
                    <div class="gym-leader-name">${escapeHtml(entry.name)}</div>
                    <div class="gym-leader-gym">${escapeHtml(entry.gym)}</div>
                </div>
                <div class="gym-leader-level${entry.isChampion ? ' champion-level' : ' elite-level'}">
                    <span class="gym-level-label">Nivel</span>
                    <span class="gym-level-value">${entry.level}</span>
                </div>
            </div>
        `;
    });

    html += '</div>';

    // Add extra categories
    function renderGenericLevelCaps(title, icon, items) {
        let subHtml = `
            <div class="gym-leaders-header" style="margin-top: 40px;">
                <div class="section-title"><span class="icon">${icon}</span><span>${title}</span></div>
            </div>
            <div class="gym-leaders-grid">
        `;
        items.forEach(item => {
            subHtml += `
                <div class="gym-leader-card gym-generic-cap">
                    <div class="gym-leader-num generic-num">${icon}</div>
                    <div class="gym-leader-badge-wrap">
                        <div class="gym-leader-no-badge">🎯</div>
                    </div>
                    <div class="gym-leader-info">
                        <div class="gym-leader-name">${escapeHtml(item.name)}</div>
                        <div class="gym-leader-gym">${escapeHtml(item.desc)}</div>
                    </div>
                    <div class="gym-leader-level">
                        <span class="gym-level-label">Nivel</span>
                        <span class="gym-level-value">${item.level}</span>
                    </div>
                </div>
            `;
        });
        subHtml += '</div>';
        return subHtml;
    }

    html += renderGenericLevelCaps('Retos Villanos (Team Skull)', '💀', RETOS_TEAM_SKULL);
    html += renderGenericLevelCaps('Retos Paraíso Aether', '🏢', RETOS_AETHER);
    html += renderGenericLevelCaps('Retos Combates Rivales', '⚔️', RETOS_RIVALES);
    html += renderGenericLevelCaps('Combates contra la Unidad Ultra', '🛸', RETOS_UNIDAD_ULTRA);
    html += renderGenericLevelCaps('Postgame: Episodio Rainbow Rocket', '🌈', RETOS_RAINBOW_ROCKET);

    container.innerHTML = html;
}

// ===================== POKEMON PERMITIDOS / PROHIBIDOS =====================

// ⚠️  EDITAR ESTAS LISTAS con los Pokémon reales cuando el organizador los facilite.
// Formato: { id: <numero_pokedex>, name: '<nombre_español>' }

const POKEMON_BANNED = [
    // --- TITANES (BST > 600) ---
    { id: 150, name: 'Mewtwo', bst: 680 },
    { id: 249, name: 'Lugia', bst: 680 },
    { id: 250, name: 'Ho-Oh', bst: 680 },
    { id: 382, name: 'Kyogre', bst: 670 },
    { id: 383, name: 'Groudon', bst: 670 },
    { id: 384, name: 'Rayquaza', bst: 680 },
    { id: 483, name: 'Dialga', bst: 680 },
    { id: 484, name: 'Palkia', bst: 680 },
    { id: 487, name: 'Giratina', bst: 680 },
    { id: 493, name: 'Arceus', bst: 720 },
    { id: 643, name: 'Reshiram', bst: 680 },
    { id: 644, name: 'Zekrom', bst: 680 },
    { id: 646, name: 'Kyurem', bst: 660 },
    { id: 10022, form: 'Black', name: 'Kyurem Negro', bst: 700 },
    { id: 10023, form: 'White', name: 'Kyurem Blanco', bst: 700 },
    { id: 716, name: 'Xerneas', bst: 680 },
    { id: 717, name: 'Yveltal', bst: 680 },
    { id: 791, name: 'Solgaleo', bst: 680 },
    { id: 792, name: 'Lunala', bst: 680 },
    { id: 10155, form: 'Dusk Mane', name: 'Necrozma Melena Crepuscular', bst: 680 },
    { id: 10156, form: 'Dawn Wings', name: 'Necrozma Alas del Alba', bst: 680 },
    { id: 10157, form: 'Ultra', name: 'Ultra Necrozma', bst: 754 },

    // --- CASOS ESPECIALES BANEADOS ---
    { id: 289, name: 'Slaking', bst: 670, reason: 'BST de Legendario y sin Ausente' },
    { id: 486, name: 'Regigigas', bst: 670, reason: 'BST de Legendario y sin Inicio Lento' }
];
const POKEMON_ALLOWED_SPECIAL = [

    { id: 144, name: 'Articuno' }, { id: 145, name: 'Zapdos' }, { id: 146, name: 'Moltres' },
    { id: 151, name: 'Mew' }, { id: 243, name: 'Raikou' }, { id: 244, name: 'Entei' },
    { id: 245, name: 'Suicune' }, { id: 251, name: 'Celebi' }, { id: 377, name: 'Regirock' },
    { id: 378, name: 'Regice' }, { id: 379, name: 'Registeel' }, { id: 380, name: 'Latias' },
    { id: 381, name: 'Latios' }, { id: 385, name: 'Jirachi' }, { id: 386, name: 'Deoxys' },

    // Gen 4-6
    { id: 480, name: 'Uxie' }, { id: 481, name: 'Mesprit' }, { id: 482, name: 'Azelf' },
    { id: 485, name: 'Heatran' }, { id: 488, name: 'Cresselia' }, { id: 490, name: 'Manaphy' },
    { id: 491, name: 'Darkrai' }, { id: 492, name: 'Shaymin' }, { id: 494, name: 'Victini' },
    { id: 638, name: 'Cobalion' }, { id: 639, name: 'Terrakion' }, { id: 640, name: 'Virizion' },
    { id: 641, name: 'Tornadus' }, { id: 642, name: 'Thundurus' }, { id: 645, name: 'Landorus' },
    { id: 647, name: 'Keldeo' }, { id: 648, name: 'Meloetta' }, { id: 649, name: 'Genesect' },
    { id: 718, name: 'Zygarde' }, { id: 719, name: 'Diancie' }, { id: 720, name: 'Hoopa' },
    { id: 721, name: 'Volcanion' },

    // Gen 7: Tapus y Ultraentes
    { id: 785, name: 'Tapu Koko' }, { id: 786, name: 'Tapu Lele' }, { id: 787, name: 'Tapu Bulu' }, { id: 788, name: 'Tapu Fini' },
    { id: 793, name: 'Nihilego' }, { id: 794, name: 'Buzzwole' }, { id: 795, name: 'Pheromosa' }, { id: 796, name: 'Xurkitree' },
    { id: 797, name: 'Celesteela' }, { id: 798, name: 'Kartana' }, { id: 799, name: 'Guzzlord' }, { id: 803, name: 'Poipole' },
    { id: 804, name: 'Naganadel' }, { id: 805, name: 'Stakataka' }, { id: 806, name: 'Blacephalon' }
];

function renderPokemonList() {
    const container = document.getElementById('pokemon-list-content');
    if (!container) return;

    function buildSection(title, emoji, items, emptyMsg, cardClass) {
        let html = `<div class="poke-list-section">`;
        html += `<h3 class="poke-list-subtitle">${emoji} ${title}</h3>`;
        if (items.length === 0) {
            html += `<p class="poke-list-empty">${emptyMsg}</p>`;
        } else {
            html += `<div class="poke-list-grid">`;
            items.forEach(p => {
                const spriteUrl = `${SPRITE_BASE}${p.id}.png`;
                html += `
                    <div class="poke-list-card ${cardClass}">
                        <img src="${spriteUrl}" alt="${escapeHtml(p.name)}" width="56" height="56"
                             style="image-rendering:pixelated"
                             onerror="this.src='${SPRITE_BASE}0.png'" />
                        <div class="poke-list-name">${escapeHtml(p.name)}</div>
                    </div>`;
            });
            html += `</div>`;
        }
        html += `</div>`;
        return html;
    }

    let html = '';

    if (POKEMON_BANNED.length === 0 && POKEMON_ALLOWED_SPECIAL.length === 0) {
        html = `
            <div class="poke-list-pending">
                <span style="font-size:2.5rem">📋</span>
                <p>La lista de Pokémon permitidos y prohibidos se publicará próximamente.</p>
            </div>`;
    } else {
        html += buildSection(
            'Pokémon Prohibidos', '⛔',
            POKEMON_BANNED,
            'No se han especificado Pokémon prohibidos aún.',
            'banned'
        );
        html += buildSection(
            'Pokémon Especiales Permitidos', '✅',
            POKEMON_ALLOWED_SPECIAL,
            'No se han especificado Pokémon especiales aún.',
            'allowed'
        );
    }

    container.innerHTML = html;
}

// ===================== AUTH SYSTEM =====================

let authToken = null;
let authUser = null;

function showAuthModal() {
    document.getElementById('auth-modal-overlay').classList.add('visible');
}

function closeAuthModal() {
    document.getElementById('auth-modal-overlay').classList.remove('visible');
    document.getElementById('login-error').textContent = '';
    document.getElementById('register-error').textContent = '';
}

function switchAuthMode(mode) {
    document.getElementById('login-form').style.display = mode === 'login' ? '' : 'none';
    document.getElementById('register-form').style.display = mode === 'register' ? '' : 'none';
    document.querySelectorAll('.auth-tab').forEach(t => {
        t.classList.toggle('active', (mode === 'login' && t.textContent.includes('Entrar')) ||
                                     (mode === 'register' && t.textContent.includes('Crear')));
    });
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;
    const errorEl = document.getElementById('login-error');
    errorEl.textContent = '';

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) { errorEl.textContent = data.error || 'Error'; return; }

        authToken = data.token;
        authUser = data.user;
        localStorage.setItem('token', data.token);
        localStorage.setItem('username', data.user.username);
        localStorage.setItem('userId', data.user.id);
        localStorage.setItem('avatarUrl', data.user.avatar_url || '');
        localStorage.setItem('streamPlatform', data.user.stream_platform || '');
        localStorage.setItem('streamChannel', data.user.stream_channel || '');
        updateAuthUI();
        closeAuthModal();
        loadTournament();
    } catch (err) {
        errorEl.textContent = 'Error de conexión';
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('register-user').value.trim();
    const password = document.getElementById('register-pass').value;
    const stream_platform = document.getElementById('register-platform').value;
    const stream_channel = document.getElementById('register-channel').value.trim();
    const errorEl = document.getElementById('register-error');
    errorEl.textContent = '';

    if (!stream_platform || !stream_channel) {
        errorEl.textContent = 'El directo y la plataforma son obligatorios';
        return;
    }

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, stream_platform, stream_channel })
        });
        const data = await res.json();
        if (!res.ok) { errorEl.textContent = data.error || 'Error'; return; }

        authToken = data.token;
        authUser = data.user;
        localStorage.setItem('token', data.token);
        localStorage.setItem('username', data.user.username);
        localStorage.setItem('userId', data.user.id);
        localStorage.setItem('avatarUrl', data.user.avatar_url || '');
        localStorage.setItem('streamPlatform', data.user.stream_platform || '');
        localStorage.setItem('streamChannel', data.user.stream_channel || '');
        updateAuthUI();
        closeAuthModal();
        loadTournament();
    } catch (err) {
        errorEl.textContent = 'Error de conexión';
    }
}

function logout() {
    authToken = null;
    authUser = null;
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('userId');
    localStorage.removeItem('avatarUrl');
    localStorage.removeItem('streamPlatform');
    localStorage.removeItem('streamChannel');
    updateAuthUI();
}

function restoreAuth() {
    const token = localStorage.getItem('token');
    const username = localStorage.getItem('username');
    const userId = localStorage.getItem('userId');
    const avatarUrl = localStorage.getItem('avatarUrl');
    const streamPlatform = localStorage.getItem('streamPlatform');
    const streamChannel = localStorage.getItem('streamChannel');
    if (token && username && userId) {
        authToken = token;
        authUser = {
            id: parseInt(userId),
            username,
            avatar_url: avatarUrl || null,
            stream_platform: streamPlatform || null,
            stream_channel: streamChannel || null
        };
    }
    updateAuthUI();
}

function updateAuthUI() {
    const authBtn = document.getElementById('auth-btn');
    const profileEl = document.getElementById('user-profile');
    const usernameEl = document.getElementById('user-username');
    const avatarContainer = document.getElementById('user-avatar-container');
    const battlesUnauth = document.getElementById('battles-unauth');
    const battlesAuthTabs = document.getElementById('battles-auth-tabs');
    const bracketPanel = document.getElementById('bpanel-bracket');
    const adminPanel = document.getElementById('bracket-admin-panel');

    if (authUser) {
        authBtn.style.display = 'none';
        profileEl.style.display = 'flex';
        usernameEl.textContent = authUser.username;
        const initial = authUser.username.charAt(0).toUpperCase();
        avatarContainer.innerHTML = authUser.avatar_url
            ? `<img src="${authUser.avatar_url}" class="avatar-circle-img" alt="${initial}" onerror="this.parentNode.textContent='${initial}'">`
            : initial;
        battlesUnauth.style.display = 'none';
        battlesAuthTabs.style.display = '';
        bracketPanel.style.display = '';
        if (authUser.username.toLowerCase() === 'gabriellucifer22') {
            adminPanel.style.display = '';
        } else {
            adminPanel.style.display = 'none';
        }
    } else {
        authBtn.style.display = '';
        profileEl.style.display = 'none';
        battlesUnauth.style.display = '';
        battlesAuthTabs.style.display = 'none';
        bracketPanel.style.display = 'none';
        document.getElementById('bpanel-mymatches').style.display = 'none';
        adminPanel.style.display = 'none';
    }
}

// ===================== PROFILE SETTINGS =====================

let _pendingAvatarDataUrl = null;

function showProfileModal() {
    if (!authUser) return;
    const overlay = document.getElementById('profile-modal-overlay');
    overlay.classList.add('visible');

    // Populate avatar preview
    const preview = document.getElementById('profile-avatar-preview');
    const initial = authUser.username.charAt(0).toUpperCase();
    if (authUser.avatar_url) {
        preview.innerHTML = `<img src="${authUser.avatar_url}" class="avatar-circle-img" alt="${initial}">`;
    } else {
        preview.innerHTML = `<span class="profile-avatar-initial">${initial}</span>`;
    }
    _pendingAvatarDataUrl = authUser.avatar_url || null;

    // Pre-fill username
    document.getElementById('profile-new-username').value = authUser.username;
    document.getElementById('profile-username-pass').value = '';
    document.getElementById('profile-current-pass').value = '';
    document.getElementById('profile-new-pass').value = '';

    // Pre-fill stream settings
    document.getElementById('profile-stream-platform').value = authUser.stream_platform || 'twitch';
    document.getElementById('profile-stream-channel').value = authUser.stream_channel || '';

    // Pre-fill OBS overlay URL
    document.getElementById('profile-obs-url').value = window.location.origin + '/overlay.html?userId=' + authUser.id;

    // Clear messages
    document.querySelectorAll('.profile-msg').forEach(el => { el.textContent = ''; el.className = 'profile-msg'; });
}

function closeProfileModal() {
    document.getElementById('profile-modal-overlay').classList.remove('visible');
}

function copyObsOverlayUrl() {
    const input = document.getElementById('profile-obs-url');
    input.select();
    input.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(input.value);

    const msgEl = document.getElementById('profile-obs-msg');
    msgEl.textContent = '¡Enlace copiado! Pégalo en tu OBS como "Fuente de Navegador".';
    setTimeout(() => {
        msgEl.textContent = '';
    }, 4000);
}

function previewProfileAvatar(input) {
    if (!input.files || !input.files[0]) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        // Resize to max 128x128 to keep data URL small
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxSize = 128;
            let w = img.width, h = img.height;
            if (w > maxSize || h > maxSize) {
                const ratio = Math.min(maxSize / w, maxSize / h);
                w = Math.round(w * ratio);
                h = Math.round(h * ratio);
            }
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/png');
            _pendingAvatarDataUrl = dataUrl;
            const preview = document.getElementById('profile-avatar-preview');
            preview.innerHTML = `<img src="${dataUrl}" class="avatar-circle-img" alt="avatar">`;
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(input.files[0]);
}

function removeProfileAvatar() {
    _pendingAvatarDataUrl = null;
    const preview = document.getElementById('profile-avatar-preview');
    const initial = authUser ? authUser.username.charAt(0).toUpperCase() : '?';
    preview.innerHTML = `<span class="profile-avatar-initial">${initial}</span>`;
}

async function saveProfileAvatar() {
    const msgEl = document.getElementById('profile-avatar-msg');
    msgEl.textContent = 'Guardando...';
    msgEl.className = 'profile-msg';

    try {
        const res = await fetch('/api/auth/avatar', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ avatarUrl: _pendingAvatarDataUrl })
        });
        const data = await res.json();
        if (!res.ok) { msgEl.textContent = data.error || 'Error'; msgEl.className = 'profile-msg error'; return; }

        authUser.avatar_url = _pendingAvatarDataUrl;
        localStorage.setItem('avatarUrl', _pendingAvatarDataUrl || '');
        try { updateAuthUI(); } catch(e) { console.warn('UI update error:', e); }
        msgEl.textContent = '✅ Avatar actualizado';
        msgEl.className = 'profile-msg success';
        try { loadData(); } catch(e) {}
    } catch (err) {
        msgEl.textContent = 'Error de conexión';
        msgEl.className = 'profile-msg error';
    }
}

async function saveProfileUsername() {
    const msgEl = document.getElementById('profile-username-msg');
    const newUsername = document.getElementById('profile-new-username').value.trim();
    const password = document.getElementById('profile-username-pass').value;
    msgEl.textContent = '';
    msgEl.className = 'profile-msg';

    if (!newUsername || !password) {
        msgEl.textContent = 'Rellena ambos campos';
        msgEl.className = 'profile-msg error';
        return;
    }

    try {
        const res = await fetch('/api/auth/username', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ newUsername, password })
        });
        const data = await res.json();
        if (!res.ok) { msgEl.textContent = data.error || 'Error'; msgEl.className = 'profile-msg error'; return; }

        authToken = data.token;
        authUser.username = data.username;
        localStorage.setItem('token', data.token);
        localStorage.setItem('username', data.username);
        try { updateAuthUI(); } catch(e) { console.warn('UI update error:', e); }
        document.getElementById('profile-username-pass').value = '';
        msgEl.textContent = '✅ Nombre actualizado';
        msgEl.className = 'profile-msg success';
        try { loadData(); } catch(e) {}
    } catch (err) {
        msgEl.textContent = 'Error de conexión';
        msgEl.className = 'profile-msg error';
    }
}

async function saveProfilePassword() {
    const msgEl = document.getElementById('profile-password-msg');
    const currentPassword = document.getElementById('profile-current-pass').value;
    const newPassword = document.getElementById('profile-new-pass').value;
    msgEl.textContent = '';
    msgEl.className = 'profile-msg';

    if (!currentPassword || !newPassword) {
        msgEl.textContent = 'Rellena ambos campos';
        msgEl.className = 'profile-msg error';
        return;
    }

    try {
        const res = await fetch('/api/auth/password', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json();
        if (!res.ok) { msgEl.textContent = data.error || 'Error'; msgEl.className = 'profile-msg error'; return; }

        document.getElementById('profile-current-pass').value = '';
        document.getElementById('profile-new-pass').value = '';
        msgEl.textContent = '✅ Contraseña actualizada';
        msgEl.className = 'profile-msg success';
    } catch (err) {
        msgEl.textContent = 'Error de conexión';
        msgEl.className = 'profile-msg error';
    }
}

async function saveProfileStream() {
    const msgEl = document.getElementById('profile-stream-msg');
    const platform = document.getElementById('profile-stream-platform').value;
    const channel = document.getElementById('profile-stream-channel').value.trim();
    msgEl.textContent = 'Guardando...';
    msgEl.className = 'profile-msg';

    if (!platform || !channel) {
        msgEl.textContent = 'Ambos campos son obligatorios';
        msgEl.className = 'profile-msg error';
        return;
    }

    try {
        const res = await fetch('/api/auth/stream', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ platform, channel })
        });
        const data = await res.json();
        if (!res.ok) {
            msgEl.textContent = data.error || 'Error';
            msgEl.className = 'profile-msg error';
            return;
        }

        authUser.stream_platform = platform;
        authUser.stream_channel = channel;
        localStorage.setItem('streamPlatform', platform);
        localStorage.setItem('streamChannel', channel);
        msgEl.textContent = '✅ Información de directo actualizada';
        msgEl.className = 'profile-msg success';
        try { loadTrainers(); } catch(e) {}
    } catch (err) {
        msgEl.textContent = 'Error de conexión';
        msgEl.className = 'profile-msg error';
    }
}

function renderStreams() {
    const section = document.getElementById('streams-section');
    const grid = document.getElementById('streams-grid');
    const countEl = document.getElementById('streams-count');
    if (!section || !grid) return;

    const liveUsers = allUsers.filter(u => u.is_live);

    if (liveUsers.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    if (countEl) {
        countEl.textContent = `${liveUsers.length} en directo`;
    }

    grid.innerHTML = '';
    liveUsers.forEach(user => {
        const initial = user.username.charAt(0).toUpperCase();
        
        let link = '#';
        const plat = (user.stream_platform || 'twitch').toLowerCase();
        const chan = user.stream_channel;
        if (plat === 'twitch') link = `https://twitch.tv/${chan}`;
        else if (plat === 'youtube') link = `https://youtube.com/@${chan}/live`;
        else if (plat === 'kick') link = `https://kick.com/${chan}`;

        // Preview thumbnail URL
        let thumbUrl = 'https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=320&auto=format&fit=crop';
        if (plat === 'twitch') {
            thumbUrl = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${chan.toLowerCase().trim()}-320x180.jpg?t=${Date.now()}`;
        } else if (plat === 'youtube') {
            thumbUrl = `https://img.youtube.com/vi/live/hqdefault.jpg`;
        }

        const card = document.createElement('a');
        card.href = link;
        card.target = '_blank';
        card.className = 'stream-card';

        const avatarHtml = renderAvatarCircle('match-avatar', initial, user.avatar_url);

        card.innerHTML = `
            <div class="stream-thumbnail-container">
                <img class="stream-thumbnail" src="${thumbUrl}" alt="Preview" onerror="this.src='https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=320&auto=format&fit=crop'">
                <div class="stream-preview-overlay"></div>
                <div class="stream-badge-row-top">
                    <span class="stream-live-badge-red">EN DIRECTO</span>
                    <span class="stream-platform-tag ${plat}">${plat}</span>
                </div>
            </div>
            <div class="stream-details-container">
                ${avatarHtml}
                <div class="stream-info">
                    <div class="stream-username">${escapeHtml(user.username)}</div>
                    <div class="stream-channel">${escapeHtml(user.stream_channel)}</div>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

// ===================== BATTLES TAB =====================

let activeBattlesTab = 'bracket';
let tournamentState = null;

function switchBattlesTab(tab) {
    activeBattlesTab = tab;
    document.querySelectorAll('.battles-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.btab === tab);
    });
    document.getElementById('bpanel-bracket').style.display = tab === 'bracket' ? '' : 'none';
    document.getElementById('bpanel-mymatches').style.display = tab === 'mymatches' ? '' : 'none';

    if (tab === 'mymatches') loadMyMatches();
    if (tab === 'bracket') loadTournament();
}

// ===================== TOURNAMENT (SWISS FORMAT) =====================

async function loadTournament() {
    try {
        const res = await fetch('/api/tournament');
        tournamentState = await res.json();
        renderSwissTournament();
    } catch (err) {
        console.error('Error loading tournament:', err);
    }
}

function renderSwissTournament() {
    const standingsEl = document.getElementById('swiss-standings');
    const roundsEl = document.getElementById('swiss-rounds');
    const championBanner = document.getElementById('swiss-champion-banner');
    const adminActions = document.getElementById('swiss-admin-actions');

    if (!standingsEl || !roundsEl) return;

    if (!tournamentState || !tournamentState.status) {
        standingsEl.innerHTML = '<p class="bracket-empty">No hay torneo activo. El admin debe generar uno.</p>';
        roundsEl.innerHTML = '';
        if (championBanner) championBanner.style.display = 'none';
        if (adminActions) adminActions.style.display = 'none';
        return;
    }

    // Champion Banner
    if (championBanner) {
        if (tournamentState.status === 'finished' && tournamentState.champion) {
            const c = tournamentState.champion;
            championBanner.innerHTML = `
                <div class="champion-content">
                    <div class="champion-trophy">🏆</div>
                    <div class="champion-info">
                        <div class="champion-label">¡CAMPEÓN DEL TORNEO!</div>
                        <div class="champion-name">
                            ${renderSmallAvatar(c)}
                            <span>${escapeHtml(c.username)}</span>
                        </div>
                    </div>
                </div>`;
            championBanner.style.display = '';
        } else {
            championBanner.style.display = 'none';
        }
    }

    // Admin advance button
    const isAdmin = authUser && authUser.username.toLowerCase() === 'gabriellucifer22';
    if (adminActions) {
        if (isAdmin && tournamentState.status === 'active') {
            adminActions.style.display = '';
            const currentRound = tournamentState.rounds.find(r => r.roundNumber === tournamentState.currentRound);
            const allCompleted = currentRound && currentRound.matches.every(m => m.status === 'completed');
            const btn = document.getElementById('swiss-advance-btn');
            if (btn) {
                btn.disabled = !allCompleted;
                btn.textContent = allCompleted
                    ? `⏭️ Avanzar a Ronda ${tournamentState.currentRound + 1}`
                    : `⏳ Esperando resultados de Ronda ${tournamentState.currentRound}...`;
            }
        } else {
            adminActions.style.display = 'none';
        }
    }

    // Render Standings
    renderSwissStandings(standingsEl);

    // Render Rounds (newest first)
    renderSwissRounds(roundsEl);
}

function renderSwissStandings(container) {
    const players = tournamentState.players || [];
    // Sort: active first, then by wins (desc), then by losses (asc)
    const sorted = [...players].sort((a, b) => {
        if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
        if (a.wins !== b.wins) return b.wins - a.wins;
        return a.losses - b.losses;
    });

    let html = '<div class="swiss-table">';
    html += `<div class="swiss-table-header">
        <span class="swiss-col-rank">#</span>
        <span class="swiss-col-player">Jugador</span>
        <span class="swiss-col-record">Récord</span>
        <span class="swiss-col-status">Estado</span>
    </div>`;

    sorted.forEach((p, i) => {
        const rank = i + 1;
        const recordClass = p.eliminated ? 'swiss-eliminated' : '';
        const wlClass = p.losses === 0 ? 'swiss-record-clean' :
                        p.losses === 1 ? 'swiss-record-ok' :
                        p.losses === 2 ? 'swiss-record-danger' : 'swiss-record-out';

        let statusBadge = '';
        if (p.eliminated) {
            statusBadge = '<span class="swiss-badge swiss-badge-eliminated">ELIMINADO</span>';
        } else if (tournamentState.champion && tournamentState.champion.id === p.id) {
            statusBadge = '<span class="swiss-badge swiss-badge-champion">🏆 CAMPEÓN</span>';
        } else {
            statusBadge = '<span class="swiss-badge swiss-badge-active">ACTIVO</span>';
        }

        html += `
        <div class="swiss-table-row ${p.eliminated ? 'swiss-row-eliminated' : ''}">
            <span class="swiss-col-rank">${rank}</span>
            <span class="swiss-col-player">
                ${renderSmallAvatar(p)}
                <span class="swiss-player-name">${escapeHtml(p.username)}</span>
                ${p.byeReceived ? '<span class="swiss-bye-tag">BYE</span>' : ''}
            </span>
            <span class="swiss-col-record ${wlClass}">${p.wins} - ${p.losses}</span>
            <span class="swiss-col-status">${statusBadge}</span>
        </div>`;
    });

    html += '</div>';
    container.innerHTML = html;
}

function renderSwissRounds(container) {
    const rounds = tournamentState.rounds || [];
    if (rounds.length === 0) {
        container.innerHTML = '<p class="bracket-empty">Sin rondas todavía.</p>';
        return;
    }

    const isAdmin = authUser && authUser.username.toLowerCase() === 'gabriellucifer22';

    // Render rounds in reverse order (newest first)
    let html = '';
    for (let i = rounds.length - 1; i >= 0; i--) {
        const round = rounds[i];
        const isCurrent = round.roundNumber === tournamentState.currentRound && tournamentState.status === 'active';

        html += `<div class="swiss-round ${isCurrent ? 'swiss-round-current' : ''}">`;
        html += `<div class="swiss-round-header">
            <span class="swiss-round-label">Ronda ${round.roundNumber}</span>
            ${isCurrent ? '<span class="swiss-round-badge">EN CURSO</span>' : '<span class="swiss-round-badge swiss-round-done">COMPLETADA</span>'}
        </div>`;

        // BYE info
        if (round.bye) {
            html += `<div class="swiss-bye-card">
                ${renderSmallAvatar(round.bye)}
                <span>${escapeHtml(round.bye.username)}</span>
                <span class="swiss-bye-label">BYE (victoria automática)</span>
            </div>`;
        }

        html += '<div class="swiss-round-matches">';
        for (const match of round.matches) {
            html += renderSwissMatchCard(match, isAdmin);
        }
        html += '</div></div>';
    }

    container.innerHTML = html;
}

function renderSwissMatchCard(match, isAdmin) {
    const p1 = match.player1;
    const p2 = match.player2;
    const p1Name = p1 ? escapeHtml(p1.username) : '—';
    const p2Name = p2 ? escapeHtml(p2.username) : '—';

    const isP1Winner = match.winnerId && p1 && match.winnerId === p1.id;
    const isP2Winner = match.winnerId && p2 && match.winnerId === p2.id;
    const isCompleted = match.status === 'completed';

    let statusIcon = '';
    if (match.status === 'conflict') statusIcon = '<span class="tb-status-icon conflict" title="Conflicto">⚠️</span>';
    else if (match.status === 'waiting_opponent') statusIcon = '<span class="tb-status-icon waiting" title="Esperando">⏳</span>';

    let adminHtml = '';
    if (isAdmin && (match.status === 'conflict' || match.status === 'pending' || match.status === 'waiting_opponent') && p1 && p2) {
        adminHtml = `
            <div class="tb-admin">
                <button class="tb-admin-btn" onclick="adminOverrideMatch('${match.id}', 2, 0)" title="Victoria ${p1Name}">👑 ${p1Name}</button>
                <button class="tb-admin-btn" onclick="adminOverrideMatch('${match.id}', 0, 2)" title="Victoria ${p2Name}">👑 ${p2Name}</button>
            </div>`;
    }

    return `
        <div class="tb-match ${isCompleted ? 'tb-completed' : ''}" data-match-id="${match.id}">
            <div class="tb-player ${isP1Winner ? 'tb-winner' : ''} ${!p1 ? 'tb-empty' : ''}">
                ${p1 ? renderSmallAvatar(p1) : ''}
                <span class="tb-player-name">${p1Name}</span>
                <span class="tb-player-score">${isCompleted ? match.score.p1 : ''}</span>
            </div>
            <div class="tb-player ${isP2Winner ? 'tb-winner' : ''} ${!p2 ? 'tb-empty' : ''}">
                ${p2 ? renderSmallAvatar(p2) : ''}
                <span class="tb-player-name">${p2Name}</span>
                <span class="tb-player-score">${isCompleted ? match.score.p2 : ''}</span>
            </div>
            ${statusIcon}
            ${adminHtml}
        </div>
    `;
}

function renderSmallAvatar(player) {
    const initial = player.username.charAt(0).toUpperCase();
    if (player.avatar_url) {
        return `<div class="match-avatar"><img src="${player.avatar_url}" class="avatar-circle-img" alt="${initial}" onerror="this.parentNode.textContent='${initial}'"></div>`;
    }
    return `<div class="match-avatar">${initial}</div>`;
}


// ===================== MY MATCHES =====================

async function loadMyMatches() {
    if (!authToken) return;

    try {
        const res = await fetch('/api/tournament/my-matches', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json();
        renderCurrentMatch(data.current);
        renderPastMatches(data.past);
    } catch (err) {
        console.error('Error loading my matches:', err);
    }
}

function renderCurrentMatch(match) {
    const container = document.getElementById('current-match-content');
    if (!container) return;

    if (!match) {
        container.innerHTML = '<p class="no-match-msg">No tienes enfrentamiento activo en este momento.</p>';
        return;
    }

    const userId = authUser.id;
    const isP1 = match.player1 && match.player1.id === userId;
    const opponent = isP1 ? match.player2 : match.player1;
    const opponentName = opponent ? escapeHtml(opponent.username) : 'BYE';

    const bracketLabel = match.roundNumber ? `⚔️ Ronda ${match.roundNumber}` : '⚔️ Torneo';

    let statusHtml = '';
    const myReport = match.reports ? match.reports[userId] : null;

    if (myReport && match.status === 'waiting_opponent') {
        statusHtml = '<div class="my-match-status waiting">⏳ Has reportado tu resultado. Esperando a tu rival...</div>';
    } else if (match.status === 'conflict') {
        statusHtml = '<div class="my-match-status conflict">⚠️ Conflicto en los resultados. El admin decidirá el ganador.</div>';
    }

    let reportHtml = '';

    if (!myReport && (match.status === 'pending' || match.status === 'waiting_opponent' || match.status === 'conflict')) {
        reportHtml = `
            <div class="report-form">
                <h4>📋 Reportar resultado (Bo3)</h4>
                <p class="report-hint">Selecciona el resultado de tu serie:</p>
                <div class="score-buttons">
                    <button class="score-btn win" onclick="reportResult('${match.id}', 2, 0)">🏆 Gané 2 - 0</button>
                    <button class="score-btn win" onclick="reportResult('${match.id}', 2, 1)">🏆 Gané 2 - 1</button>
                    <button class="score-btn lose" onclick="reportResult('${match.id}', 1, 2)">💀 Perdí 1 - 2</button>
                    <button class="score-btn lose" onclick="reportResult('${match.id}', 0, 2)">💀 Perdí 0 - 2</button>
                </div>
            </div>
        `;
    } else if (myReport) {
        const myScore = isP1 ? myReport.p1 : myReport.p2;
        const enScore = isP1 ? myReport.p2 : myReport.p1;
        reportHtml = `<div class="my-report-sent">✅ Ya has reportado: <strong>${myScore} - ${enScore}</strong></div>`;
    }

    container.innerHTML = `
        <div class="current-match-card">
            <div class="current-match-bracket">${bracketLabel}</div>
            <div class="current-match-vs">
                <div class="current-match-player you">
                    ${renderSmallAvatar(authUser)}
                    <span>${escapeHtml(authUser.username)}</span>
                    <span class="you-badge">TÚ</span>
                </div>
                <div class="current-match-separator">VS</div>
                <div class="current-match-player opponent">
                    ${opponent ? renderSmallAvatar(opponent) : ''}
                    <span>${opponentName}</span>
                </div>
            </div>
            ${statusHtml}
            ${reportHtml}
        </div>
    `;
}

function renderPastMatches(matches) {
    const container = document.getElementById('past-matches-content');
    if (!container) return;

    if (!matches || matches.length === 0) {
        container.innerHTML = '<p class="no-match-msg">Sin enfrentamientos pasados.</p>';
        return;
    }

    const userId = authUser.id;

    let html = '';
    matches.forEach(match => {
        const isP1 = match.player1 && match.player1.id === userId;
        const opponent = isP1 ? match.player2 : match.player1;
        const opponentName = opponent ? escapeHtml(opponent.username) : 'BYE';
        const won = match.winnerId === userId;
        const myScore = isP1 ? match.score.p1 : match.score.p2;
        const opScore = isP1 ? match.score.p2 : match.score.p1;
        const bracketLabel = match.roundNumber ? `Ronda ${match.roundNumber}` : 'Torneo';

        html += `
            <div class="past-match-row ${won ? 'past-win' : 'past-loss'}">
                <span class="past-result-icon">${won ? '🏆' : '💀'}</span>
                ${opponent ? renderSmallAvatar(opponent) : ''}
                <span class="past-opponent">${opponentName}</span>
                <span class="past-score">${myScore} - ${opScore}</span>
                <span class="past-bracket">${bracketLabel}</span>
                ${match.adminOverride ? '<span class="past-admin">👑 Admin</span>' : ''}
            </div>
        `;
    });

    container.innerHTML = html;
}

// ===================== REPORT & ADMIN ACTIONS =====================

async function reportResult(matchId, myScore, enemyScore) {
    if (!authToken) return;

    try {
        const res = await fetch('/api/tournament/report', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ matchId, myScore, enemyScore })
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Error al reportar');
            return;
        }
        loadMyMatches();
        loadTournament();
    } catch (err) {
        alert('Error de conexión');
    }
}

async function adminOverrideMatch(matchId, p1Wins, p2Wins) {
    if (!authToken) return;
    if (!confirm(`¿Forzar resultado ${p1Wins} - ${p2Wins}?`)) return;

    try {
        const res = await fetch('/api/tournament/admin/override', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ matchId, p1Wins, p2Wins })
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Error');
            return;
        }
        loadTournament();
        loadMyMatches();
    } catch (err) {
        alert('Error de conexión');
    }
}

async function adminAdvanceRound() {
    if (!authToken) return;
    if (!confirm('¿Avanzar a la siguiente ronda? Todos los partidos deben estar completados.')) return;

    try {
        const res = await fetch('/api/tournament/advance-round', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            }
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Error');
            return;
        }
        if (data.message) alert(data.message);
        loadTournament();
        loadMyMatches();
    } catch (err) {
        alert('Error de conexión');
    }
}

// ===================== TOURNAMENT CREATOR (Admin Drag & Drop) =====================

let tcAvailablePlayers = [];
let tcSelectedPlayers = [];
let tcDraggedPlayerId = null;
let tcDragSource = null; // 'available' or 'selected'

function toggleTournamentCreator() {
    const panel = document.getElementById('tournament-creator');
    const isHidden = panel.style.display === 'none';
    panel.style.display = isHidden ? '' : 'none';
    if (isHidden) loadTournamentPlayers();
}

async function loadTournamentPlayers() {
    if (!authToken) return;
    try {
        const res = await fetch('/api/tournament/players', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) return;
        const players = await res.json();
        // Place all in available, keep existing selected if any
        const selectedIds = new Set(tcSelectedPlayers.map(p => p.id));
        tcAvailablePlayers = players.filter(p => !selectedIds.has(p.id));
        // Keep only selected players that still exist
        const allIds = new Set(players.map(p => p.id));
        tcSelectedPlayers = tcSelectedPlayers.filter(p => allIds.has(p.id));
        tcRenderBothLists();
    } catch (err) {
        console.error('Error loading players:', err);
    }
}

function tcRenderBothLists() {
    tcRenderList('tc-available-list', tcAvailablePlayers, 'available');
    tcRenderList('tc-selected-list', tcSelectedPlayers, 'selected');
    document.getElementById('tc-available-count').textContent = tcAvailablePlayers.length;
    document.getElementById('tc-selected-count').textContent = tcSelectedPlayers.length;
    document.getElementById('tc-generate-count').textContent = tcSelectedPlayers.length;

    const genBtn = document.getElementById('tc-generate-btn');
    genBtn.disabled = tcSelectedPlayers.length < 2;

    // Show/hide placeholders
    document.getElementById('tc-available-placeholder').style.display = tcAvailablePlayers.length === 0 ? '' : 'none';
    document.getElementById('tc-selected-placeholder').style.display = tcSelectedPlayers.length === 0 ? '' : 'none';
}

function tcRenderList(containerId, players, listType) {
    const container = document.getElementById(containerId);
    let html = '';
    players.forEach((p, idx) => {
        const initial = p.username.charAt(0).toUpperCase();
        const avatarHtml = p.avatar_url
            ? `<img src="${p.avatar_url}" class="avatar-circle-img" alt="${initial}" onerror="this.parentNode.textContent='${initial}'">`
            : initial;
        const seedBadge = listType === 'selected' ? `<span class="tc-seed">#${idx + 1}</span>` : '';
        html += `
            <div class="tc-player-card"
                 draggable="true"
                 data-player-id="${p.id}"
                 data-list-type="${listType}"
                 ondragstart="tcDragStart(event, ${p.id}, '${listType}')"
                 ondragend="tcDragEnd(event)"
                 onclick="tcClickTransfer(${p.id}, '${listType}')">
                <div class="tc-player-avatar">${avatarHtml}</div>
                <span class="tc-player-name">${escapeHtml(p.username)}</span>
                ${seedBadge}
                <span class="tc-transfer-icon">${listType === 'available' ? '→' : '←'}</span>
            </div>`;
    });
    container.innerHTML = html;
}

function tcClickTransfer(playerId, fromList) {
    if (fromList === 'available') {
        const idx = tcAvailablePlayers.findIndex(p => p.id === playerId);
        if (idx === -1) return;
        const [player] = tcAvailablePlayers.splice(idx, 1);
        tcSelectedPlayers.push(player);
    } else {
        const idx = tcSelectedPlayers.findIndex(p => p.id === playerId);
        if (idx === -1) return;
        const [player] = tcSelectedPlayers.splice(idx, 1);
        tcAvailablePlayers.push(player);
        tcAvailablePlayers.sort((a, b) => a.username.localeCompare(b.username));
    }
    tcRenderBothLists();
}

function tcDragStart(e, playerId, source) {
    tcDraggedPlayerId = playerId;
    tcDragSource = source;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', playerId);
    e.target.classList.add('tc-dragging');
}

function tcDragEnd(e) {
    e.target.classList.remove('tc-dragging');
    document.querySelectorAll('.tc-drop-zone').forEach(z => z.classList.remove('tc-drag-over'));
    tcDraggedPlayerId = null;
    tcDragSource = null;
}

function tcDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('tc-drag-over');
}

function tcDragLeave(e) {
    e.currentTarget.classList.remove('tc-drag-over');
}

function tcDropToAvailable(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('tc-drag-over');
    if (tcDragSource === 'selected' && tcDraggedPlayerId !== null) {
        tcClickTransfer(tcDraggedPlayerId, 'selected');
    }
}

function tcDropToSelected(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('tc-drag-over');
    if (tcDragSource === 'available' && tcDraggedPlayerId !== null) {
        tcClickTransfer(tcDraggedPlayerId, 'available');
    }
}

function tcSelectAll() {
    tcSelectedPlayers = tcSelectedPlayers.concat(tcAvailablePlayers);
    tcAvailablePlayers = [];
    tcRenderBothLists();
}

function tcClearAll() {
    tcAvailablePlayers = tcAvailablePlayers.concat(tcSelectedPlayers);
    tcSelectedPlayers = [];
    tcAvailablePlayers.sort((a, b) => a.username.localeCompare(b.username));
    tcRenderBothLists();
}

function tcShuffleSelected() {
    for (let i = tcSelectedPlayers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tcSelectedPlayers[i], tcSelectedPlayers[j]] = [tcSelectedPlayers[j], tcSelectedPlayers[i]];
    }
    tcRenderBothLists();
}

async function adminGenerateTournament() {
    if (!authToken) return;
    if (tcSelectedPlayers.length < 2) {
        alert('Necesitas al menos 2 jugadores seleccionados.');
        return;
    }
    if (!confirm(`¿Generar un nuevo torneo con ${tcSelectedPlayers.length} jugadores? Esto reemplazará el torneo actual.`)) return;

    const playerIds = tcSelectedPlayers.map(p => p.id);

    try {
        const res = await fetch('/api/tournament/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ playerIds })
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Error');
            return;
        }
        // Close creator panel and reload bracket
        document.getElementById('tournament-creator').style.display = 'none';
        loadTournament();
    } catch (err) {
        alert('Error de conexión');
    }
}

async function adminResetTournament() {
    if (!authToken) return;
    if (!confirm('¿Estás seguro de que quieres RESETEAR el torneo actual? Se perderán todos los resultados.')) return;

    try {
        const res = await fetch('/api/tournament/reset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            }
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || 'Error');
            return;
        }
        loadTournament();
    } catch (err) {
        alert('Error de conexión');
    }
}

