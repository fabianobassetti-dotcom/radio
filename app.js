/**
 * Bassetti Web Rádio — Core Engine
 * Sistema Inteligente de Monitoramento e Chaveamento de Áudio
 */

const App = {
    // Instância global do elemento nativo de áudio
    audio: new Audio(),
    
    // URLs de Origem (Mídia e Captura de Imagem)
    cameraURL: "https://cameras.santoandre.sp.gov.br/coi04/ID_596",
    streamPrincipal: "https://stream.zeno.fm/auauo2vfekltv/stream",
    streamBackup: "http://08.stmip.net:8046/stream",

    // Estados Operacionais do Sistema
    estado: {
        tocandoPrincipal: false,
        tocandoBackup: false,
        reproduzindo: false
    },

    // Elementos de Controle do DOM Mapeados
    DOM: null,

    /**
     * Inicializador do Ecossistema
     */
    init() {
        this.mapearDOM();
        this.bindEvents();
        
        // Inicializa o looping de renderização da Câmera IP (Frame a Frame)
        this.atualizarCamera();
        setInterval(() => this.atualizarCamera(), 1000);
        
        // Inicializa o Watchdog de estabilidade da rede a cada 5 segundos
        setInterval(() => this.watchdogMonitor(), 5000);
    },

    /**
     * Cache de Elementos da Interface para Performance
     */
    mapearDOM() {
        this.DOM = {
            camStream: document.getElementById("cam-stream"),
            btnPlayback: document.getElementById("btn-playback"),
            sliderVolume: document.getElementById("slider-volume"),
            statusLed: document.getElementById("status-led"),
            statusText: document.getElementById("status-text")
        };
    },

    /**
     * Registro de Interações do Usuário
     */
    bindEvents() {
        // Gatilho de Inicialização (Exigência de segurança dos navegadores modernos)
        this.DOM.btnPlayback.addEventListener("click", () => {
            this.iniciarTransmissaoPrincipal();
            this.DOM.btnPlayback.style.display = "none";
            this.estado.reproduzindo = true;
        });

        // Controle Dinâmico Volumétrico
        this.DOM.sliderVolume.addEventListener("input", (e) => {
            this.audio.volume = e.target.value;
        });
    },

    /**
     * Força o download da imagem limpa da câmera pública contornando o cache local
     */
    atualizarCamera() {
        if (this.DOM.camStream) {
            this.DOM.camStream.src = `${this.cameraURL}?cacheBuster=${Date.now()}`;
        }
    },

    /**
     * Painel de Telemetria Visual (LED e Texto Informativo)
     */
    atualizarPainelStatus(classeLed, mensagem) {
        if (!this.DOM.statusLed || !this.DOM.statusText) return;
        
        this.DOM.statusLed.className = `led ${classeLed}`;
        this.DOM.statusText.textContent = mensagem;
    },

    /**
     * Linha de Frente: Ativação do Stream Primário
     */
    async iniciarTransmissaoPrincipal() {
        try {
            this.audio.src = this.streamPrincipal;
            await this.audio.play();
            
            this.estado.tocandoPrincipal = true;
            this.estado.tocandoBackup = false;
            this.atualizarPainelStatus("led-live", "▶️ TRANSMISSÃO AO VIVO (PRINCIPAL)");
        } catch (erro) {
            console.warn("[Rádio Hub] Link principal indisponível. Acionando contingência...", erro);
            this.iniciarTransmissaoBackup();
        }
    },

    /**
     * Contingência: Ativação do Stream Secundário (Programação Automática)
     */
    async iniciarTransmissaoBackup() {
        try {
            this.audio.src = this.streamBackup;
            await this.audio.play();
            
            this.estado.tocandoPrincipal = false;
            this.estado.tocandoBackup = true;
            this.atualizarPainelStatus("led-backup", "▶️ PROGRAMAÇÃO AUTOMÁTICA");
        } catch (erro) {
            console.error("[Rádio Hub] Erro crítico: Ambos os servidores de áudio falharam.", erro);
            this.atualizarPainelStatus("led-inactive", "🔴 Link Indisponível (Sem Sinal)");
        }
    },

    /**
     * Testador Assíncrono de Integridade de Stream
     * Cria um canal lógico isolado em memória para não congelar o áudio do usuário ativo
     */
    async checarIntegridadeStream(url) {
        return new Promise((resolve) => {
            const probeAudio = new Audio();
            let finalizado = false;

            const encerrarTeste = (resultado) => {
                if (!finalizado) {
                    finalizado = true;
                    probeAudio.src = ""; // Libera o recurso imediatamente da memória
                    resolve(resultado);
                }
            };

            // Eventos que validam que os dados estão chegando e o áudio pode tocar
            probeAudio.onplaying = () => encerrarTeste(true);
            probeAudio.oncanplaythrough = () => encerrarTeste(true);
            
            // Eventos que acusam queda de rede ou erro no servidor de streaming
            probeAudio.onerror = () => encerrarTeste(false);
            probeAudio.onstalled = () => encerrarTeste(false);

            // Injeta parâmetro de tempo para forçar verificação real no servidor do link
            probeAudio.src = `${url}?probe=${Date.now()}`;
            probeAudio.load();

            // Timeout de Segurança: Se o servidor demorar mais de 4 segundos para responder, condena o link
            setTimeout(() => encerrarTeste(false), 4000);
        });
    },

    /**
     * Watchdog Guardião: Monitora e decide em tempo real qual fonte deve estar ativa
     */
    async watchdogMonitor() {
        // Se o usuário ainda não clicou em Play, o monitor permanece em modo de espera
        if (!this.estado.reproduzindo) return;

        // 1. Testa a integridade da rádio principal
        const isPrincipalOnline = await this.checarIntegridadeStream(this.streamPrincipal);

        if (isPrincipalOnline) {
            // Se o principal voltou a ficar online mas o player está rodando o backup, faz o chaveamento de volta
            if (!this.estado.tocandoPrincipal) {
                console.log("[Watchdog] Recuperação detectada. Retornando para o fluxo principal.");
                this.iniciarTransmissaoPrincipal();
            }
            return;
        }

        // 2. Se a principal caiu, testa a linha de backup
        const isBackupOnline = await this.checarIntegridadeStream(this.streamBackup);

        if (isBackupOnline) {
            // Se o backup está de pé e ainda não foi acionado, chaveia para ele
            if (!this.estado.tocandoBackup) {
                console.warn("[Watchdog] Falha no fluxo principal. Mudando para a Programação Automática.");
                this.iniciarTransmissaoBackup();
            }
            return;
        }

        // 3. Caso ambos os servidores estejam fora do ar
        this.atualizarPainelStatus("led-inactive", "🔴 Queda de Conexão com os Servidores de Rádio");
    }
};

// Dispara a inicialização segura após a árvore do documento estar montada
document.addEventListener("DOMContentLoaded", () => App.init());
