// ===== VOICE MANAGER (WebRTC Mesh nativo) =====
// P2P audio via RTCPeerConnection. Signaling via Socket.io (server.js como relay).
// Funciona apenas em modo multiplayer real (socketClient != null).

class VoiceManager {
  constructor() {
    this.myId        = null;
    this.localStream = null;
    this.isMuted     = false;
    // socketId → { pc, gainNode, analyser, ctx, audio, _speaking }
    this.peers       = new Map();
    this._onSpeaking = null; // callback(socketId, bool)
    this._pollTimer  = null;
    this._socketCli  = null;
    // Bound handlers (para remover com off)
    this._handlers   = {};
    // FIX BUG-2: armazena filtro de time para aplicar em peers tardios (ontrack)
    this._teamFilter = null; // { myTeam, socketTeamMap } | null
  }

  // Inicia voz: pede microfone, registra listeners de signaling
  // Retorna true se mic disponível, false caso contrário
  async init(mySocketId, socketCli, onSpeakingChange) {
    this.myId        = mySocketId;
    this._socketCli  = socketCli;
    this._onSpeaking = onSpeakingChange;

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
      console.warn('[Voice] Microfone indisponível:', e.message);
      return false;
    }

    this._handlers.offer  = ({ fromPlayerId, payload }) => this._onOffer(fromPlayerId, payload);
    this._handlers.answer = ({ fromPlayerId, payload }) => this._onAnswer(fromPlayerId, payload);
    this._handlers.ice    = ({ fromPlayerId, payload }) => this._onIce(fromPlayerId, payload);

    // FIX BUG-1: evita glare condition (ambos enviam offer simultaneamente).
    // Quando todos navegam para game.html ao mesmo tempo e mandam voice_hello,
    // sem esta regra ambos chamariam connectPeer um no outro → nenhum responderia.
    // Solução: apenas o peer com socketId lexicograficamente MAIOR envia o offer.
    this._handlers.hello = ({ fromPlayerId }) => {
      if (this.myId > fromPlayerId) {
        this.connectPeer(fromPlayerId);
      }
      // else: aguarda o offer do outro lado (ele é quem tem ID maior)
    };

    socketCli.on('webrtc_offer',         this._handlers.offer);
    socketCli.on('webrtc_answer',        this._handlers.answer);
    socketCli.on('webrtc_ice_candidate', this._handlers.ice);
    socketCli.on('voice_hello',          this._handlers.hello);

    this._startSpeakingPoll();
    return true;
  }

  // Inicia conexão com um peer (this = iniciador → envia offer)
  // FIX BUG-3: try-catch para evitar erro silencioso se destroy() ocorre durante handshake
  async connectPeer(peerId) {
    if (this.peers.has(peerId)) return;
    try {
      const pc = this._createPC(peerId);
      this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this._socketCli.sendWebRTCSignal('webrtc_offer', { targetPlayerId: peerId, payload: offer });
    } catch (e) {
      console.warn('[Voice] connectPeer falhou para', peerId, ':', e.message);
      this.peers.delete(peerId);
    }
  }

  _createPC(peerId) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    // Registra imediatamente para evitar duplicata
    this.peers.set(peerId, { pc, gainNode: null, analyser: null, ctx: null, audio: null, _speaking: false });

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this._socketCli.sendWebRTCSignal('webrtc_ice_candidate', { targetPlayerId: peerId, payload: candidate });
      }
    };

    pc.ontrack = ({ streams: [stream] }) => {
      const ctx      = new AudioContext();
      const src      = ctx.createMediaStreamSource(stream);
      const gain     = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(gain);
      gain.connect(analyser);
      gain.connect(ctx.destination);
      // Elemento <audio> garante reprodução mesmo sem saída no ctx.destination
      const audio = new Audio();
      audio.srcObject = stream;
      audio.play().catch(() => {});

      // FIX BUG-2: aplica filtro de time imediatamente ao receber áudio,
      // capturando peers que conectam APÓS setTeamFilter() ter sido chamado.
      if (this._teamFilter) {
        const { myTeam, socketTeamMap } = this._teamFilter;
        const ally = !myTeam || socketTeamMap[peerId] === myTeam;
        gain.gain.value = ally ? 1.0 : 0.0;
      }

      const entry = this.peers.get(peerId);
      if (entry) Object.assign(entry, { gainNode: gain, analyser, ctx, audio });
    };

    return pc;
  }

  // Recebe offer → responde como receptor
  async _onOffer(fromId, offer) {
    if (this.peers.has(fromId)) return; // já conectado
    try {
      const pc = this._createPC(fromId);
      this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream));
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this._socketCli.sendWebRTCSignal('webrtc_answer', { targetPlayerId: fromId, payload: answer });
    } catch (e) {
      console.warn('[Voice] _onOffer falhou para', fromId, ':', e.message);
      this.peers.delete(fromId);
    }
  }

  async _onAnswer(fromId, answer) {
    const p = this.peers.get(fromId);
    if (p) await p.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  async _onIce(fromId, candidate) {
    const p = this.peers.get(fromId);
    if (p) await p.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  disconnectPeer(socketId) {
    const p = this.peers.get(socketId);
    if (!p) return;
    p.pc?.close();
    p.ctx?.close();
    this.peers.delete(socketId);
    this._onSpeaking?.(socketId, false);
  }

  // Modo times: muta gainNode de peers de outro time
  // FIX BUG-2: armazena filtro para aplicar em peers que conectam depois
  setTeamFilter(myTeam, socketTeamMap) {
    this._teamFilter = { myTeam, socketTeamMap };
    this.peers.forEach((p, socketId) => {
      if (!p.gainNode) return; // será aplicado em ontrack quando conectar
      const ally = !myTeam || socketTeamMap[socketId] === myTeam;
      p.gainNode.gain.value = ally ? 1.0 : 0.0;
    });
  }

  // Lobby ou FFA: todos ouvem todos
  setLobbyMode() {
    this._teamFilter = null;
    this.peers.forEach(p => { if (p.gainNode) p.gainNode.gain.value = 1.0; });
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = !this.isMuted; });
    return this.isMuted;
  }

  _startSpeakingPoll() {
    const buf = new Uint8Array(32);
    this._pollTimer = setInterval(() => {
      this.peers.forEach((p, socketId) => {
        if (!p.analyser) return;
        p.analyser.getByteFrequencyData(buf);
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
        const speaking = avg > 20;
        if (p._speaking !== speaking) {
          p._speaking = speaking;
          this._onSpeaking?.(socketId, speaking);
        }
      });
    }, 100);
  }

  destroy() {
    clearInterval(this._pollTimer);
    this._pollTimer  = null;
    this._teamFilter = null;
    this.peers.forEach((_, id) => this.disconnectPeer(id));
    this.localStream?.getTracks().forEach(t => t.stop());
    this.localStream = null;
    this.myId        = null;
    // Remove listeners registrados no socketClient
    if (this._socketCli) {
      this._socketCli.off('webrtc_offer',         this._handlers.offer);
      this._socketCli.off('webrtc_answer',        this._handlers.answer);
      this._socketCli.off('webrtc_ice_candidate', this._handlers.ice);
      this._socketCli.off('voice_hello',          this._handlers.hello);
    }
    this._handlers = {};
  }
}

const voiceManager = new VoiceManager();
