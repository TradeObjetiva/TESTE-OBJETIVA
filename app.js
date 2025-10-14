// Sistema de Controle de Atendimento - COMPLETO ATUALIZADO
class SistemaAtendimento {
    constructor() {
        this.dados = {
            colaboradores: [],
            lojas: [],
            atividades: [],
            visitas: []
        };

        this.metasDia = { seg: 8, ter: 8, qua: 8, qui: 8, sex: 8, sab: 4 };
        this.agendaViewMode = 'collapsed';
        this.editingMode = false;
        this.expandedCollaborators = new Set();

        this.cacheManager = new CacheManager();
        this.notificationManager = new NotificationManager(this);
        this.backupManager = new BackupManager(this);
        this.otimizadorRota = new OtimizadorRota(this);
        this.filtroAvancado = new FiltroAvancado(this);
        this.validador = new ValidadorDados();
        this.analisePreditiva = new AnalisePreditiva(this);

        this.cacheHoras = new Map();
        this.debouncerFiltro = new Debouncer(500);
        this.chartInstance = null;

        this.init();
    }

    async init() {
        await this.carregarDadosComLoading();
        this.bindEvents();
        this.atualizarInterface();
        this.notificationManager.verificarAlertas();
    }

    async carregarDadosComLoading() {
        this.mostrarLoading();
        try {
            await this.carregarDados();
        } catch (error) {
            this.mostrarMensagem(`Erro ao carregar dados: ${error.message}`, 'danger');
        } finally {
            this.esconderLoading();
        }
    }

    mostrarLoading() {
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'loading-overlay';
        loadingDiv.innerHTML = `
            <div class="loading-spinner">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Carregando...</span>
                </div>
                <p class="mt-2">Carregando dados...</p>
            </div>
        `;
        loadingDiv.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(255,255,255,0.8);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9999;
        `;
        document.body.appendChild(loadingDiv);
    }

    esconderLoading() {
        const loadingDiv = document.getElementById('loading-overlay');
        if (loadingDiv) loadingDiv.remove();
    }

    getCampoDiaHoje() {
        const map = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
        const hoje = new Date().getDay();
        const campo = map[hoje];
        return campo === 'dom' ? 'seg' : campo;
    }

    getMetaMediaDia() {
        const total = this.metasDia.seg + this.metasDia.ter + this.metasDia.qua +
            this.metasDia.qui + this.metasDia.sex + this.metasDia.sab;
        return total / 6;
    }

    carregarDados() {
        try {
            const dadosSalvos = localStorage.getItem('sistemaAtendimento');
            if (dadosSalvos) {
                this.dados = JSON.parse(dadosSalvos);
                this.cacheHoras.clear();
            }
        } catch (error) {
            throw new Error(`Falha ao carregar dados: ${error.message}`);
        }
    }

    salvarDados() {
        try {
            localStorage.setItem('sistemaAtendimento', JSON.stringify(this.dados));
            this.cacheHoras.clear();
        } catch (e) {
            throw new Error('Falha ao salvar dados localmente.');
        }
    }

    bindEvents() {
        // Importação de arquivo
        const fileInput = document.getElementById('file-input');
        const fileDropArea = document.getElementById('file-drop-area');

        fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

        fileDropArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            fileDropArea.classList.add('dragover');
        });

        fileDropArea.addEventListener('dragleave', () => {
            fileDropArea.classList.remove('dragover');
        });

        fileDropArea.addEventListener('drop', (e) => {
            e.preventDefault();
            fileDropArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length) {
                fileInput.files = files;
                this.handleFileSelect({ target: fileInput });
            }
        });

        // Botões principais
        document.getElementById('btn-confirmar-importacao').addEventListener('click', () => this.confirmarImportacao());
        document.getElementById('btn-gerar-relatorio-dia').addEventListener('click', () => this.gerarRelatorioDia());
        document.getElementById('btn-gerar-relatorio-colab').addEventListener('click', () => this.gerarRelatorioColaborador());
        document.getElementById('btn-toggle-view').addEventListener('click', () => this.toggleAgendaView());
        document.getElementById('btn-export-agenda').addEventListener('click', () => this.exportarAgenda());
        document.getElementById('btn-edit-agenda').addEventListener('click', () => this.toggleEditMode());
        document.getElementById('btn-save-agenda').addEventListener('click', () => this.salvarAlteracoesAgenda());
        document.getElementById('btn-cancel-edit').addEventListener('click', () => this.cancelarEdicao());
        document.getElementById('btn-add-visita').addEventListener('click', () => this.adicionarNovaVisita());
        document.getElementById('btn-fazer-backup').addEventListener('click', () => this.backupManager.fazerBackup());
        document.getElementById('btn-otimizar-rotas').addEventListener('click', () => this.otimizarRotas());
        document.getElementById('btn-limpar-filtro').addEventListener('click', () => this.limparFiltroAtividades());

        // Filtros
        document.getElementById('select-colaborador-agenda').addEventListener('input', () => {
            this.debouncerFiltro.executar(() => this.atualizarAgenda());
        });

        document.getElementById('select-filtro-atividade-lojas').addEventListener('change', () => {
            this.atualizarTabelaLojas();
        });
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        const fileName = file.name;
        const fileSize = (file.size / 1024 / 1024).toFixed(2);

        document.getElementById('file-info').innerHTML = `
            <div class="alert alert-info">
                <strong>Arquivo selecionado:</strong> ${fileName}<br>
                <strong>Tamanho:</strong> ${fileSize} MB
            </div>
        `;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                this.exibirPreview(jsonData);
            } catch (error) {
                this.mostrarMensagem('Erro ao ler o arquivo: ' + error.message, 'danger');
            }
        };
        reader.readAsArrayBuffer(file);
    }

    exibirPreview(data) {
        const previewDiv = document.getElementById('preview-data');
        const previewTable = document.getElementById('preview-table');

        previewTable.querySelector('thead tr').innerHTML = '';
        previewTable.querySelector('tbody').innerHTML = '';

        if (data.length === 0) {
            previewDiv.style.display = 'none';
            return;
        }

        // Cabeçalho
        const headerRow = data[0];
        headerRow.forEach(cell => {
            const th = document.createElement('th');
            th.textContent = cell;
            previewTable.querySelector('thead tr').appendChild(th);
        });

        // Dados
        const maxRows = Math.min(10, data.length - 1);
        for (let i = 1; i <= maxRows; i++) {
            const row = data[i];
            const tr = document.createElement('tr');
            row.forEach(cell => {
                const td = document.createElement('td');
                td.textContent = cell || '';
                tr.appendChild(td);
            });
            previewTable.querySelector('tbody').appendChild(tr);
        }

        previewDiv.style.display = 'block';

        if (data.length - 1 > maxRows) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = headerRow.length;
            td.className = 'text-center text-muted';
            td.textContent = `... e mais ${data.length - 1 - maxRows} linhas`;
            tr.appendChild(td);
            previewTable.querySelector('tbody').appendChild(tr);
        }
    }

    confirmarImportacao() {
        const fileInput = document.getElementById('file-input');
        const file = fileInput.files[0];

        if (!file) {
            this.mostrarMensagem('Nenhum arquivo selecionado.', 'warning');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                this.processarDadosExcel(jsonData);
                this.mostrarMensagem('Dados importados com sucesso!', 'success');

                fileInput.value = '';
                document.getElementById('file-info').innerHTML = '';
                document.getElementById('preview-data').style.display = 'none';
            } catch (error) {
                this.mostrarMensagem('Erro ao processar dados: ' + error.message, 'danger');
            }
        };
        reader.readAsArrayBuffer(file);
    }

    processarDadosExcel(data) {
        try {
            if (!Array.isArray(data) || data.length < 2) {
                throw new Error('Planilha vazia ou sem dados suficientes');
            }

            this.dados = { colaboradores: [], lojas: [], atividades: [], visitas: [] };
            const headers = data[0];

            const normalizeHeader = (name) => {
                if (!name) return '';
                return name.toString()
                    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                    .replace(/\./g, '')
                    .replace(/\s+/g, '_')
                    .toUpperCase();
            };

            const headerMap = {};
            headers.forEach((h, i) => { headerMap[normalizeHeader(h)] = i; });

            const colIndex = {
                AGENTE: headerMap['AGENTE'],
                ID_AGENT: headerMap['ID_AGENT'],
                LOCAL: headerMap['LOCAL'],
                ID_LOCAL: headerMap['ID_LOCAL'],
                REDE: headerMap['REDE'],
                CLIENTE: headerMap['CLIENTE'],
                LOGRADOURO: headerMap['LOGRADOURO'],
                BAIRRO: headerMap['BAIRRO'],
                MUNICÍPIO: headerMap['MUNICIPIO'] ?? headerMap['MUNICÍPIO'],
                ESTADO: headerMap['ESTADO'],
                ATIVIDADE: headerMap['ATIVIDADE'],
                ID_ACTIVITY: headerMap['ID_ACTIVITY'],
                HORAS_VISITA: headerMap['HORAS_POR_VISITA'] ?? headerMap['HORAS_VISITA'],
                CUSTO_VISITA: headerMap['CUSTO_VISITA'],
                SEG: headerMap['SEG'],
                TER: headerMap['TER'],
                QUA: headerMap['QUA'],
                QUI: headerMap['QUI'],
                SEX: headerMap['SEX'],
                SAB: headerMap['SAB'],
                FREQ_SEMANAL: headerMap['FREQ_SEMANAL'] ?? headerMap['FREQ__SEMANAL'] ?? headerMap['FREQ_SEMANAL_'] ?? headerMap['FREQ_']
            };

            const obrigatorias = ['AGENTE', 'ID_AGENT', 'LOCAL', 'ID_LOCAL', 'ATIVIDADE', 'ID_ACTIVITY'];
            const ausentes = obrigatorias.filter(k => colIndex[k] === undefined);
            if (ausentes.length) {
                throw new Error('Colunas obrigatórias ausentes: ' + ausentes.join(', '));
            }

            const colaboradoresMap = new Map();
            const lojasMap = new Map();
            const atividadesMap = new Map();
            let visitaId = 1;

            for (let i = 1; i < data.length; i++) {
                const row = data[i];
                if (row.length === 0) continue;

                const nomeColaborador = row[colIndex.AGENTE];
                const idAgent = row[colIndex.ID_AGENT] ? row[colIndex.ID_AGENT].toString() : '';
                const nomeLoja = row[colIndex.LOCAL];
                const idLocal = row[colIndex.ID_LOCAL] ? row[colIndex.ID_LOCAL].toString() : '';
                const rede = row[colIndex.REDE] || '';
                const cliente = row[colIndex.CLIENTE] || '';
                const endereco = row[colIndex.LOGRADOURO] || '';
                const bairro = row[colIndex.BAIRRO] || '';
                const municipio = row[colIndex.MUNICÍPIO] || '';
                const estado = row[colIndex.ESTADO] || '';
                const nomeAtividade = row[colIndex.ATIVIDADE];
                const idActivity = row[colIndex.ID_ACTIVITY] ? row[colIndex.ID_ACTIVITY].toString() : '';
                const horasVisita = parseFloat(row[colIndex.HORAS_VISITA]) || 0;
                const custoVisita = parseFloat(row[colIndex.CUSTO_VISITA]) || 0;

                const seg = this.parseDiaSemanaMelhorado(row[colIndex.SEG]);
                const ter = this.parseDiaSemanaMelhorado(row[colIndex.TER]);
                const qua = this.parseDiaSemanaMelhorado(row[colIndex.QUA]);
                const qui = this.parseDiaSemanaMelhorado(row[colIndex.QUI]);
                const sex = this.parseDiaSemanaMelhorado(row[colIndex.SEX]);
                const sab = this.parseDiaSemanaMelhorado(row[colIndex.SAB]);
                const freqSemanal = row[colIndex.FREQ_SEMANAL] || 'SEMANAL';

                // Validar dados
                if (!idAgent || !nomeColaborador || !idLocal || !nomeLoja || !idActivity || !nomeAtividade) {
                    continue;
                }

                // Adicionar colaborador
                if (idAgent && !colaboradoresMap.has(idAgent)) {
                    const colaborador = { id: colaboradoresMap.size + 1, id_agent: idAgent, nome: nomeColaborador };
                    this.dados.colaboradores.push(colaborador);
                    colaboradoresMap.set(idAgent, colaborador.id);
                }

                // Adicionar loja
                if (idLocal && !lojasMap.has(idLocal)) {
                    const loja = {
                        id: lojasMap.size + 1, id_local: idLocal, nome: nomeLoja, rede: rede,
                        cliente: cliente, endereco: endereco, bairro: bairro, municipio: municipio, estado: estado
                    };
                    this.dados.lojas.push(loja);
                    lojasMap.set(idLocal, loja.id);
                }

                // Adicionar atividade
                if (idActivity && !atividadesMap.has(idActivity)) {
                    const atividade = {
                        id: atividadesMap.size + 1, id_activity: idActivity, nome: nomeAtividade,
                        horas_visita: horasVisita, custo_visita: custoVisita
                    };
                    this.dados.atividades.push(atividade);
                    atividadesMap.set(idActivity, atividade.id);
                }

                const idColaborador = colaboradoresMap.get(idAgent);
                const idLoja = lojasMap.get(idLocal);
                const idAtividade = atividadesMap.get(idActivity);

                if (idColaborador && idLoja && idAtividade) {
                    const visita = {
                        id: visitaId++, id_colaborador: idColaborador, id_loja: idLoja, id_atividade: idAtividade,
                        cliente: cliente, seg: seg, ter: ter, qua: qua, qui: qui, sex: sex, sab: sab, freq_semanal: freqSemanal
                    };
                    this.dados.visitas.push(visita);
                }
            }

            this.salvarDados();
            this.atualizarInterface();
            this.notificationManager.verificarAlertas();

        } catch (error) {
            throw new Error(`Falha no processamento: ${error.message}`);
        }
    }

    parseDiaSemanaMelhorado(valor) {
        if (valor === null || valor === undefined || valor === '') return false;
        const valorStr = valor.toString().toLowerCase().trim();
        if (valorStr === 'x' || valorStr === '1' || valorStr === 'true' || valorStr === 'sim') return true;
        const valorNum = parseFloat(valorStr);
        return !isNaN(valorNum) && valorNum > 0;
    }

    atualizarInterface() {
        this.atualizarComponentesVisuais();
        this.atualizarDadosCalculados();
    }

    atualizarComponentesVisuais() {
        this.atualizarEstatisticas();
        this.atualizarTabelas();
        this.atualizarAgenda();
        this.atualizarSelects();
    }

    atualizarDadosCalculados() {
        this.atualizarDashboardHoras();
        this.atualizarAnalises();
    }

    atualizarEstatisticas() {
        document.getElementById('total-colaboradores').textContent = this.dados.colaboradores.length;
        document.getElementById('total-lojas').textContent = this.dados.lojas.length;

        const campoHoje = this.getCampoDiaHoje();
        const visitasHoje = this.dados.visitas.filter(v => v[campoHoje]).length;
        document.getElementById('visitas-hoje').textContent = visitasHoje;

        let totalHorasDia = 0;
        this.dados.colaboradores.forEach(colaborador => {
            totalHorasDia += this.calcularHorasPorDiaColaborador(colaborador.id);
        });

        const mediaHorasDia = this.dados.colaboradores.length > 0 ? totalHorasDia / this.dados.colaboradores.length : 0;
        document.getElementById('horas-totais').textContent = mediaHorasDia.toFixed(1);

        document.getElementById('badge-total-colaboradores').textContent = this.dados.colaboradores.length;
        document.getElementById('badge-total-lojas').textContent = this.dados.lojas.length;
    }

    atualizarDashboardHoras() {
        const container = document.getElementById('dashboard-horas');
        if (this.dados.colaboradores.length === 0) {
            container.innerHTML = '<p class="text-muted">Nenhum dado disponível</p>';
            return;
        }

        const diasSemana = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
        const camposDias = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
        let html = '<div class="row">';

        diasSemana.forEach((dia, index) => {
            const campoDia = camposDias[index];
            const totalHorasDia = this.calcularTotalHorasPorDia(campoDia);
            const metaDia = this.metasDia[campoDia] || 0;
            const capacidadeDia = this.dados.colaboradores.length * metaDia;
            const percentualMeta = capacidadeDia > 0 ? (totalHorasDia / capacidadeDia) * 100 : 0;
            const corBarra = percentualMeta >= 90 ? 'bg-success' : percentualMeta >= 70 ? 'bg-warning' : 'bg-danger';

            html += `
                <div class="col-md-4 mb-3">
                    <div class="d-flex justify-content-between mb-1">
                        <strong>${dia}</strong>
                        <span>${totalHorasDia.toFixed(1)}h / ${capacidadeDia.toFixed(1)}h</span>
                    </div>
                    <div class="progress">
                        <div class="progress-bar ${corBarra}" role="progressbar" 
                             style="width: ${Math.min(percentualMeta, 100)}%" 
                             aria-valuenow="${percentualMeta}" aria-valuemin="0" aria-valuemax="100">
                            ${percentualMeta.toFixed(0)}%
                        </div>
                    </div>
                    <small class="text-muted">${this.dados.visitas.filter(v => v[campoDia]).length} visitas programadas</small>
                </div>
            `;
        });

        html += '</div>';
        container.innerHTML = html;
    }

    calcularHorasPorDiaColaborador(idColaborador) {
        const cacheKey = `horas_dia_${idColaborador}`;
        const cached = this.cacheManager.get(cacheKey);
        if (cached !== null) return cached;

        let totalHoras = 0;
        const dias = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
        dias.forEach(dia => {
            totalHoras += this.calcularHorasPorDiaColaboradorDetalhado(idColaborador, dia);
        });

        const resultado = totalHoras / 6;
        this.cacheManager.set(cacheKey, resultado);
        return resultado;
    }

    calcularHorasPorDiaColaboradorDetalhado(idColaborador, dia) {
        const cacheKey = `horas_dia_detalhado_${idColaborador}_${dia}`;
        const cached = this.cacheManager.get(cacheKey);
        if (cached !== null) return cached;

        let totalHoras = 0;
        const visitasDia = this.dados.visitas.filter(v => v.id_colaborador === idColaborador && v[dia]);
        visitasDia.forEach(visita => {
            const atividade = this.dados.atividades.find(a => a.id === visita.id_atividade);
            if (atividade) totalHoras += atividade.horas_visita;
        });

        this.cacheManager.set(cacheKey, totalHoras);
        return totalHoras;
    }

    calcularTotalHorasPorDia(campoDia) {
        const cacheKey = `total_horas_dia_${campoDia}`;
        const cached = this.cacheManager.get(cacheKey);
        if (cached !== null) return cached;

        let totalHoras = 0;
        this.dados.visitas.forEach(visita => {
            if (visita[campoDia]) {
                const atividade = this.dados.atividades.find(a => a.id === visita.id_atividade);
                if (atividade) totalHoras += atividade.horas_visita;
            }
        });

        this.cacheManager.set(cacheKey, totalHoras);
        return totalHoras;
    }

    verificarHorasExtras(horas, dia) {
        const limite = dia === 'sab' ? 4 : 8;
        return horas > limite;
    }

    // ATUALIZADO: Calcular total de horas da semana
    calcularTotalHorasSemanaColaborador(idColaborador) {
        const cacheKey = `total_semana_${idColaborador}`;
        const cached = this.cacheManager.get(cacheKey);
        if (cached !== null) return cached;

        let totalHoras = 0;
        const dias = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

        dias.forEach(dia => {
            totalHoras += this.calcularHorasPorDiaColaboradorDetalhado(idColaborador, dia);
        });

        this.cacheManager.set(cacheKey, totalHoras);
        return totalHoras;
    }

    // ATUALIZADO: Verificar se total semanal ultrapassa 44 horas
    verificarTotalSemanalExtras(totalHoras) {
        return totalHoras > 44;
    }

    atualizarTabelaColaboradores() {
        const tbody = document.querySelector('#tabela-colaboradores tbody');
        tbody.innerHTML = '';
        this.dados.colaboradores.forEach(colaborador => {
            const tr = ElementFactory.criarLinhaColaborador(colaborador, this);
            tbody.appendChild(tr);
        });
    }

    atualizarTabelaLojas() {
        const tbody = document.querySelector('#tabela-lojas tbody');
        tbody.innerHTML = '';
        const filtroAtividade = document.getElementById('select-filtro-atividade-lojas').value;

        let lojasParaExibir = this.dados.lojas;
        if (filtroAtividade !== 'todas') {
            const idAtividadeFiltro = parseInt(filtroAtividade);
            const lojasComAtividade = [...new Set(this.dados.visitas.filter(v => v.id_atividade === idAtividadeFiltro).map(v => v.id_loja))];
            lojasParaExibir = this.dados.lojas.filter(l => lojasComAtividade.includes(l.id));
        }

        lojasParaExibir.forEach(loja => {
            const tr = ElementFactory.criarLinhaLoja(loja, this);
            tbody.appendChild(tr);
        });
    }

    atualizarTabelas() {
        this.atualizarTabelaColaboradores();
        this.atualizarTabelaLojas();
    }

    // ATUALIZADO: Agenda com cálculo correto do total
    atualizarAgenda() {
        const tbody = document.getElementById('tabela-agenda-body');
        tbody.innerHTML = '';
        const filtroColaborador = document.getElementById('select-colaborador-agenda').value;

        let colaboradoresParaExibir = this.dados.colaboradores;
        if (filtroColaborador !== 'todos') {
            colaboradoresParaExibir = this.dados.colaboradores.filter(c => c.id.toString() === filtroColaborador);
            this.expandedCollaborators.add(parseInt(filtroColaborador));
        }

        colaboradoresParaExibir.forEach(colaborador => {
            // Calcular totais por dia
            const horasSeg = this.calcularHorasPorDiaColaboradorDetalhado(colaborador.id, 'seg');
            const horasTer = this.calcularHorasPorDiaColaboradorDetalhado(colaborador.id, 'ter');
            const horasQua = this.calcularHorasPorDiaColaboradorDetalhado(colaborador.id, 'qua');
            const horasQui = this.calcularHorasPorDiaColaboradorDetalhado(colaborador.id, 'qui');
            const horasSex = this.calcularHorasPorDiaColaboradorDetalhado(colaborador.id, 'sex');
            const horasSab = this.calcularHorasPorDiaColaboradorDetalhado(colaborador.id, 'sab');

            // Calcular total da semana (soma de todos os dias)
            const totalHorasSemana = horasSeg + horasTer + horasQua + horasQui + horasSex + horasSab;

            // Verificar se ultrapassa 44 horas
            const totalExtra = this.verificarTotalSemanalExtras(totalHorasSemana);

            const trColab = this.criarLinhaAgendaColaborador(
                colaborador,
                horasSeg, horasTer, horasQua, horasQui, horasSex, horasSab,
                totalHorasSemana,
                totalExtra
            );
            tbody.appendChild(trColab);

            trColab.addEventListener('click', () => this.toggleCollaboratorDetails(colaborador.id));

            const isExpanded = this.expandedCollaborators.has(colaborador.id) || this.agendaViewMode === 'expanded';
            if (isExpanded) {
                const visitasColab = this.dados.visitas.filter(v => v.id_colaborador === colaborador.id);
                visitasColab.forEach(visita => {
                    const trLoja = ElementFactory.criarLinhaAgendaLoja(visita, this);
                    if (trLoja) tbody.appendChild(trLoja);
                });
            }
        });
    }

    // NOVO: Criar linha de colaborador com totais corretos
    criarLinhaAgendaColaborador(colaborador, horasSeg, horasTer, horasQua, horasQui, horasSex, horasSab, totalHorasSemana, totalExtra) {
        // Verificar horas extras por dia
        const segExtra = this.verificarHorasExtras(horasSeg, 'seg');
        const terExtra = this.verificarHorasExtras(horasTer, 'ter');
        const quaExtra = this.verificarHorasExtras(horasQua, 'qua');
        const quiExtra = this.verificarHorasExtras(horasQui, 'qui');
        const sexExtra = this.verificarHorasExtras(horasSex, 'sex');
        const sabExtra = this.verificarHorasExtras(horasSab, 'sab');

        const isExpanded = this.expandedCollaborators.has(colaborador.id) || this.agendaViewMode === 'expanded';

        const tr = document.createElement('tr');
        tr.className = 'collaborator-row';
        tr.setAttribute('data-colaborador-id', colaborador.id);
        tr.innerHTML = `
            <td>
                <span class="toggle-icon ${isExpanded ? 'rotated' : ''}">
                    <i class="fas fa-chevron-right"></i>
                </span>
                <strong>${colaborador.nome}</strong>
                <br>
                <small class="text-muted">${colaborador.id_agent}</small>
            </td>
            <td class="day-column">
                <span class="day-hours ${segExtra ? 'day-extra' : ''}" 
                      title="Segunda: ${horasSeg.toFixed(1)}h ${segExtra ? '(acima de 8h)' : ''}">
                    ${horasSeg.toFixed(1)}h
                </span>
            </td>
            <td class="day-column">
                <span class="day-hours ${terExtra ? 'day-extra' : ''}" 
                      title="Terça: ${horasTer.toFixed(1)}h ${terExtra ? '(acima de 8h)' : ''}">
                    ${horasTer.toFixed(1)}h
                </span>
            </td>
            <td class="day-column">
                <span class="day-hours ${quaExtra ? 'day-extra' : ''}" 
                      title="Quarta: ${horasQua.toFixed(1)}h ${quaExtra ? '(acima de 8h)' : ''}">
                    ${horasQua.toFixed(1)}h
                </span>
            </td>
            <td class="day-column">
                <span class="day-hours ${quiExtra ? 'day-extra' : ''}" 
                      title="Quinta: ${horasQui.toFixed(1)}h ${quiExtra ? '(acima de 8h)' : ''}">
                    ${horasQui.toFixed(1)}h
                </span>
            </td>
            <td class="day-column">
                <span class="day-hours ${sexExtra ? 'day-extra' : ''}" 
                      title="Sexta: ${horasSex.toFixed(1)}h ${sexExtra ? '(acima de 8h)' : ''}">
                    ${horasSex.toFixed(1)}h
                </span>
            </td>
            <td class="day-column">
                <span class="day-hours ${sabExtra ? 'day-sabado-extra' : ''}" 
                      title="Sábado: ${horasSab.toFixed(1)}h ${sabExtra ? '(acima de 4h)' : ''}">
                    ${horasSab.toFixed(1)}h
                </span>
            </td>
            <td class="total-column">
                <span class="total-hours ${totalExtra ? 'total-extra' : 'total-normal'}" 
                      title="Total Semanal: ${totalHorasSemana.toFixed(1)}h ${totalExtra ? '(acima de 44h)' : '(até 44h)'}">
                    ${totalHorasSemana.toFixed(1)}h
                    ${totalExtra ? '<br><small class="extra-badge">EXTRA</small>' : ''}
                </span>
            </td>
        `;
        return tr;
    }

    toggleCollaboratorDetails(colaboradorId) {
        if (this.expandedCollaborators.has(colaboradorId)) {
            this.expandedCollaborators.delete(colaboradorId);
        } else {
            this.expandedCollaborators.add(colaboradorId);
        }
        this.atualizarAgenda();
    }

    atualizarSelects() {
        const selectColabAgenda = document.getElementById('select-colaborador-agenda');
        const selectColabRelatorio = document.getElementById('select-colaborador');
        const selectFiltroAtividade = document.getElementById('select-filtro-atividade-lojas');

        selectColabAgenda.innerHTML = '<option value="todos">Todos os Colaboradores</option>';
        selectColabRelatorio.innerHTML = '';
        selectFiltroAtividade.innerHTML = '<option value="todas">Todas as Atividades</option>';

        this.dados.colaboradores.forEach(colaborador => {
            const optionAgenda = document.createElement('option');
            optionAgenda.value = colaborador.id;
            optionAgenda.textContent = colaborador.nome;
            selectColabAgenda.appendChild(optionAgenda);

            const optionRelatorio = document.createElement('option');
            optionRelatorio.value = colaborador.id;
            optionRelatorio.textContent = colaborador.nome;
            selectColabRelatorio.appendChild(optionRelatorio);
        });

        this.dados.atividades.forEach(atividade => {
            const option = document.createElement('option');
            option.value = atividade.id;
            option.textContent = atividade.nome;
            selectFiltroAtividade.appendChild(option);
        });
    }

    toggleAgendaView() {
        const btn = document.getElementById('btn-toggle-view');
        if (this.agendaViewMode === 'collapsed') {
            this.agendaViewMode = 'expanded';
            btn.innerHTML = '<i class="fas fa-compress"></i> Visualização Resumida';
            this.expandedCollaborators.clear();
        } else {
            this.agendaViewMode = 'collapsed';
            btn.innerHTML = '<i class="fas fa-expand"></i> Visualização Detalhada';
        }
        this.atualizarAgenda();
    }

    toggleEditMode() {
        this.editingMode = !this.editingMode;
        const editor = document.getElementById('agenda-editor');
        const agendaTable = document.getElementById('tabela-agenda-body').parentNode.parentNode;

        if (this.editingMode) {
            editor.style.display = 'block';
            agendaTable.style.display = 'none';
            this.carregarEditorAgenda();
        } else {
            editor.style.display = 'none';
            agendaTable.style.display = 'table';
        }
    }

    carregarEditorAgenda() {
        const tbody = document.getElementById('tabela-agenda-editor-body');
        tbody.innerHTML = '';

        this.dados.visitas.forEach(visita => {
            const colaborador = this.dados.colaboradores.find(c => c.id === visita.id_colaborador);
            const loja = this.dados.lojas.find(l => l.id === visita.id_loja);
            const atividade = this.dados.atividades.find(a => a.id === visita.id_atividade);

            if (colaborador && loja && atividade) {
                const tr = ElementFactory.criarLinhaEditorVisita(visita, colaborador, loja, atividade);
                tbody.appendChild(tr);

                tr.querySelector('.btn-remove-visita').addEventListener('click', () => {
                    this.removerVisita(visita.id);
                });
            }
        });
    }

    adicionarNovaVisita() {
        const modalHtml = `
            <div class="modal fade" id="modal-nova-visita" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Adicionar Nova Visita</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <form id="form-nova-visita">
                                <div class="row">
                                    <div class="col-md-6">
                                        <div class="mb-3">
                                            <label class="form-label">Colaborador *</label>
                                            <select class="form-select" name="colaborador" required>
                                                <option value="">Selecione...</option>
                                                ${this.dados.colaboradores.map(c => `<option value="${c.id}">${c.nome}</option>`).join('')}
                                            </select>
                                        </div>
                                    </div>
                                    <div class="col-md-6">
                                        <div class="mb-3">
                                            <label class="form-label">Cliente *</label>
                                            <input type="text" class="form-control" name="cliente" required placeholder="Nome do cliente">
                                        </div>
                                    </div>
                                </div>
                                <div class="row">
                                    <div class="col-md-6">
                                        <div class="mb-3">
                                            <label class="form-label">Loja *</label>
                                            <select class="form-select" name="loja" required>
                                                <option value="">Selecione...</option>
                                                ${this.dados.lojas.map(l => `<option value="${l.id}">${l.nome}</option>`).join('')}
                                            </select>
                                        </div>
                                    </div>
                                    <div class="col-md-6">
                                        <div class="mb-3">
                                            <label class="form-label">Atividade *</label>
                                            <select class="form-select" name="atividade" required>
                                                <option value="">Selecione...</option>
                                                ${this.dados.atividades.map(a => `<option value="${a.id}">${a.nome}</option>`).join('')}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                                <div class="row">
                                    <div class="col-md-6">
                                        <div class="mb-3">
                                            <label class="form-label">Horas por Visita *</label>
                                            <input type="number" class="form-control" name="horas_visita" step="0.5" min="0.5" value="1" required>
                                        </div>
                                    </div>
                                    <div class="col-md-6">
                                        <div class="mb-3">
                                            <label class="form-label">Frequência Semanal</label>
                                            <select class="form-select" name="freq_semanal">
                                                <option value="SEMANAL">Semanal</option>
                                                <option value="QUINZENAL">Quinzenal</option>
                                                <option value="MENSAL">Mensal</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">Dias da Semana *</label>
                                    <div class="row">
                                        <div class="col-4"><div class="form-check"><input class="form-check-input" type="checkbox" name="dias" value="seg" id="check-seg"><label class="form-check-label" for="check-seg">Segunda</label></div></div>
                                        <div class="col-4"><div class="form-check"><input class="form-check-input" type="checkbox" name="dias" value="ter" id="check-ter"><label class="form-check-label" for="check-ter">Terça</label></div></div>
                                        <div class="col-4"><div class="form-check"><input class="form-check-input" type="checkbox" name="dias" value="qua" id="check-qua"><label class="form-check-label" for="check-qua">Quarta</label></div></div>
                                        <div class="col-4"><div class="form-check"><input class="form-check-input" type="checkbox" name="dias" value="qui" id="check-qui"><label class="form-check-label" for="check-qui">Quinta</label></div></div>
                                        <div class="col-4"><div class="form-check"><input class="form-check-input" type="checkbox" name="dias" value="sex" id="check-sex"><label class="form-check-label" for="check-sex">Sexta</label></div></div>
                                        <div class="col-4"><div class="form-check"><input class="form-check-input" type="checkbox" name="dias" value="sab" id="check-sab"><label class="form-check-label" for="check-sab">Sábado</label></div></div>
                                    </div>
                                </div>
                            </form>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                            <button type="button" class="btn btn-primary" id="btn-confirmar-visita">Confirmar</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        if (!document.getElementById('modal-nova-visita')) {
            document.body.insertAdjacentHTML('beforeend', modalHtml);
        }

        const modal = new bootstrap.Modal(document.getElementById('modal-nova-visita'));
        modal.show();

        document.getElementById('btn-confirmar-visita').addEventListener('click', () => {
            this.confirmarNovaVisita();
            modal.hide();
        });
    }

    confirmarNovaVisita() {
        const form = document.getElementById('form-nova-visita');
        const formData = new FormData(form);

        const novaVisita = {
            id: Math.max(0, ...this.dados.visitas.map(v => v.id)) + 1,
            id_colaborador: parseInt(formData.get('colaborador')),
            id_loja: parseInt(formData.get('loja')),
            id_atividade: parseInt(formData.get('atividade')),
            cliente: formData.get('cliente'),
            seg: formData.getAll('dias').includes('seg'),
            ter: formData.getAll('dias').includes('ter'),
            qua: formData.getAll('dias').includes('qua'),
            qui: formData.getAll('dias').includes('qui'),
            sex: formData.getAll('dias').includes('sex'),
            sab: formData.getAll('dias').includes('sab'),
            freq_semanal: formData.get('freq_semanal')
        };

        const erros = this.validador.validarVisita(novaVisita);
        if (erros.length > 0) {
            this.mostrarMensagem(`Erros na visita: ${erros.join(', ')}`, 'danger');
            return;
        }

        this.dados.visitas.push(novaVisita);
        this.salvarDados();

        if (this.editingMode) this.carregarEditorAgenda();
        this.atualizarAgenda();
        this.mostrarMensagem('Nova visita adicionada com sucesso!', 'success');
    }

    removerVisita(visitaId) {
        if (confirm('Tem certeza que deseja remover esta visita?')) {
            this.dados.visitas = this.dados.visitas.filter(v => v.id !== visitaId);
            this.carregarEditorAgenda();
            this.mostrarMensagem('Visita removida com sucesso', 'success');
        }
    }

    salvarAlteracoesAgenda() {
        const rows = document.querySelectorAll('#tabela-agenda-editor-body tr');
        rows.forEach((row) => {
            const visitaId = parseInt(row.getAttribute('data-visita-id'));
            const visita = this.dados.visitas.find(v => v.id === visitaId);
            if (visita) {
                visita.seg = row.querySelector('[data-field="seg"]').checked;
                visita.ter = row.querySelector('[data-field="ter"]').checked;
                visita.qua = row.querySelector('[data-field="qua"]').checked;
                visita.qui = row.querySelector('[data-field="qui"]').checked;
                visita.sex = row.querySelector('[data-field="sex"]').checked;
                visita.sab = row.querySelector('[data-field="sab"]').checked;
            }
        });

        this.salvarDados();
        this.mostrarMensagem('Alterações salvas com sucesso!', 'success');
        this.toggleEditMode();
        this.atualizarInterface();
    }

    cancelarEdicao() {
        this.toggleEditMode();
        this.mostrarMensagem('Edição cancelada', 'info');
    }

    exportarAgenda() {
        try {
            const dadosExportacao = this.prepararDadosExportacao();
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(dadosExportacao);
            XLSX.utils.book_append_sheet(wb, ws, "Agenda");
            XLSX.writeFile(wb, `agenda-${new Date().toISOString().split('T')[0]}.xlsx`);
            this.mostrarMensagem('Agenda exportada com sucesso!', 'success');
        } catch (error) {
            this.mostrarMensagem('Erro ao exportar agenda: ' + error.message, 'danger');
        }
    }

    prepararDadosExportacao() {
        return this.dados.visitas.map(visita => {
            const colaborador = this.dados.colaboradores.find(c => c.id === visita.id_colaborador);
            const loja = this.dados.lojas.find(l => l.id === visita.id_loja);
            const atividade = this.dados.atividades.find(a => a.id === visita.id_atividade);

            return {
                'Colaborador': colaborador?.nome || '',
                'ID Colaborador': colaborador?.id_agent || '',
                'Loja': loja?.nome || '',
                'ID Loja': loja?.id_local || '',
                'Rede': loja?.rede || '',
                'Cliente': visita.cliente || '',
                'Atividade': atividade?.nome || '',
                'Horas por Visita': atividade?.horas_visita || 0,
                'Segunda': visita.seg ? 'X' : '',
                'Terça': visita.ter ? 'X' : '',
                'Quarta': visita.qua ? 'X' : '',
                'Quinta': visita.qui ? 'X' : '',
                'Sexta': visita.sex ? 'X' : '',
                'Sábado': visita.sab ? 'X' : '',
                'Frequência Semanal': visita.freq_semanal
            };
        });
    }

    limparFiltroAtividades() {
        document.getElementById('select-filtro-atividade-lojas').value = 'todas';
        this.atualizarTabelaLojas();
    }

    mostrarAtividadesLoja(loja, atividades) {
        const modalHtml = `
            <div class="modal fade" id="modal-atividades-loja" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Atividades - ${loja.nome}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="mb-3">
                                <strong>Informações da Loja:</strong><br>
                                Rede: ${loja.rede} | Bairro: ${loja.bairro} | Município: ${loja.municipio}
                                ${loja.cliente ? `<br>Cliente: ${loja.cliente}` : ''}
                            </div>
                            <div class="table-responsive">
                                <table class="table table-striped">
                                    <thead>
                                        <tr>
                                            <th>Atividade</th>
                                            <th>Tempo/Visita</th>
                                            <th>Frequência</th>
                                            <th>Dias de Visita</th>
                                            <th>Cliente</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${atividades.map(atividade => `
                                            <tr>
                                                <td>${atividade.nome}</td>
                                                <td>${atividade.horas}h</td>
                                                <td>${atividade.frequencia}</td>
                                                <td>${atividade.dias}</td>
                                                <td>${atividade.cliente}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                            ${atividades.length === 0 ? '<div class="alert alert-info">Nenhuma atividade cadastrada para esta loja.</div>' : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;

        if (!document.getElementById('modal-atividades-loja')) {
            document.body.insertAdjacentHTML('beforeend', modalHtml);
        } else {
            document.getElementById('modal-atividades-loja').remove();
            document.body.insertAdjacentHTML('beforeend', modalHtml);
        }

        const modal = new bootstrap.Modal(document.getElementById('modal-atividades-loja'));
        modal.show();
    }

    async otimizarRotas() {
        this.mostrarLoading();
        try {
            const colaboradorId = document.getElementById('select-colaborador-agenda').value;
            if (colaboradorId === 'todos') {
                this.mostrarMensagem('Selecione um colaborador específico para otimizar rotas', 'warning');
                return;
            }

            const rotaOtimizada = await this.otimizadorRota.otimizarRotas(parseInt(colaboradorId));
            this.mostrarRotaOtimizada(rotaOtimizada);
        } catch (error) {
            this.mostrarMensagem(`Erro ao otimizar rotas: ${error.message}`, 'danger');
        } finally {
            this.esconderLoading();
        }
    }

    mostrarRotaOtimizada(rota) {
        const modalHtml = `
            <div class="modal fade" id="modal-rota" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Rota Otimizada</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="rota-list">
                                ${rota.lojas.map((loja, index) => `
                                    <div class="rota-item ${index === 0 ? 'active' : ''}">
                                        <span class="rota-ordem">${index + 1}</span>
                                        <div class="rota-info">
                                            <strong>${loja.nome}</strong>
                                            <small class="text-muted">${loja.endereco}</small>
                                        </div>
                                        ${index < rota.lojas.length - 1 ? '<div class="rota-connector"><i class="fas fa-arrow-down"></i></div>' : ''}
                                    </div>
                                `).join('')}
                            </div>
                            <div class="mt-3 p-3 bg-light rounded">
                                <strong>Resumo da Rota:</strong><br>
                                • Total de lojas: ${rota.lojas.length}<br>
                                • Distância estimada: ${rota.distanciaTotal} km<br>
                                • Tempo estimado: ${rota.tempoEstimado}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        if (!document.getElementById('modal-rota')) {
            document.body.insertAdjacentHTML('beforeend', modalHtml);
        }

        const modal = new bootstrap.Modal(document.getElementById('modal-rota'));
        modal.show();
    }

    atualizarAnalises() {
        this.atualizarAnalisesEficiencia();
        this.atualizarAlertasSistema();
    }

    atualizarAnalisesEficiencia() {
        const container = document.getElementById('analises-eficiencia');
        if (this.dados.colaboradores.length === 0) {
            container.innerHTML = '<p class="text-muted">Nenhum dado disponível para análise</p>';
            return;
        }

        const totalHorasProgramadas = this.dados.visitas.reduce((total, visita) => {
            const atividade = this.dados.atividades.find(a => a.id === visita.id_atividade);
            return total + (atividade ? atividade.horas_visita : 0);
        }, 0);

        const horasPorColaborador = this.dados.colaboradores.length > 0 ? totalHorasProgramadas / this.dados.colaboradores.length : 0;
        const metaMediaDia = this.getMetaMediaDia();
        const eficienciaMedia = metaMediaDia > 0 ? (horasPorColaborador / metaMediaDia) * 100 : 0;

        let html = `
            <div class="analise-item ${eficienciaMedia >= 80 ? 'sucesso' : 'alerta'}" data-action="show-all">
                <h6><i class="fas ${eficienciaMedia >= 80 ? 'fa-check-circle' : 'fa-exclamation-triangle'} me-2"></i>
                Eficiência Média da Equipe</h6>
                <p>Média de <strong>${horasPorColaborador.toFixed(1)}h/dia</strong> por colaborador 
                (${eficienciaMedia.toFixed(1)}% da meta média de ${metaMediaDia.toFixed(1)}h/dia)</p>
            </div>
        `;

        const colaboradoresAbaixoMeta = this.dados.colaboradores.filter(colab => {
            const horasDia = this.calcularHorasPorDiaColaborador(colab.id);
            return horasDia < this.getMetaMediaDia() * 0.8;
        }).length;

        if (colaboradoresAbaixoMeta > 0) {
            html += `
                <div class="analise-item alerta" data-action="show-underperforming">
                    <h6><i class="fas fa-user-clock me-2"></i>Oportunidade de Otimização</h6>
                    <p><strong>${colaboradoresAbaixoMeta} colaborador(es)</strong> estão abaixo de 80% da meta diária.
                    Considere redistribuir atividades.</p>
                </div>
            `;
        }

        container.innerHTML = html;
        this.bindAnalysisEvents();
    }

    bindAnalysisEvents() {
        const analysisItems = document.querySelectorAll('#analises-eficiencia .analise-item');
        analysisItems.forEach(item => {
            item.addEventListener('click', () => {
                const action = item.getAttribute('data-action');
                this.handleAnalysisClick(action);
            });
        });
    }

    handleAnalysisClick(action) {
        this.showTab('agenda');
        switch (action) {
            case 'show-all':
                document.getElementById('select-colaborador-agenda').value = 'todos';
                this.agendaViewMode = 'expanded';
                document.getElementById('btn-toggle-view').innerHTML = '<i class="fas fa-compress"></i> Visualização Resumida';
                break;
            case 'show-underperforming':
                const underperforming = this.dados.colaboradores.filter(colab => {
                    const horasDia = this.calcularHorasPorDiaColaborador(colab.id);
                    return horasDia < this.getMetaMediaDia() * 0.8;
                });
                if (underperforming.length > 0) {
                    document.getElementById('select-colaborador-agenda').value = underperforming[0].id;
                    this.expandedCollaborators.clear();
                    this.expandedCollaborators.add(underperforming[0].id);
                }
                break;
        }
        this.atualizarAgenda();
    }

    atualizarAlertasSistema() {
        const container = document.getElementById('alertas-sistema');
        this.notificationManager.mostrarAlertasUI(container);
    }

    showTab(tabName) {
        const tabLink = document.querySelector(`[href="#${tabName}"]`);
        if (tabLink) tabLink.click();
    }

    gerarRelatorioDia() {
        const diaSelecionado = document.getElementById('select-dia').value;
        const relatorioDiv = document.getElementById('relatorio-dia');

        const diaMap = {
            'segunda': 'seg', 'terca': 'ter', 'quarta': 'qua',
            'quinta': 'qui', 'sexta': 'sex', 'sabado': 'sab'
        };

        const campoDia = diaMap[diaSelecionado];
        const visitasDia = this.dados.visitas.filter(v => v[campoDia]);

        if (visitasDia.length === 0) {
            relatorioDiv.innerHTML = '<div class="alert alert-info">Nenhuma visita agendada para este dia.</div>';
            return;
        }

        let html = `
            <h6>Visitas para ${diaSelecionado.charAt(0).toUpperCase() + diaSelecionado.slice(1)}</h6>
            <div class="table-responsive">
                <table class="table table-striped">
                    <thead>
                        <tr>
                            <th>Colaborador</th>
                            <th>Loja</th>
                            <th>Cliente</th>
                            <th>Atividade</th>
                            <th>Horas</th>
                            <th>Frequência</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        let totalHoras = 0;
        visitasDia.forEach(visita => {
            const colaborador = this.dados.colaboradores.find(c => c.id === visita.id_colaborador);
            const loja = this.dados.lojas.find(l => l.id === visita.id_loja);
            const atividade = this.dados.atividades.find(a => a.id === visita.id_atividade);

            if (colaborador && loja && atividade) {
                totalHoras += atividade.horas_visita;
                html += `
                    <tr>
                        <td>${colaborador.nome}</td>
                        <td>${loja.nome}</td>
                        <td>${visita.cliente || 'Não informado'}</td>
                        <td>${atividade.nome}</td>
                        <td>${atividade.horas_visita}h</td>
                        <td>${visita.freq_semanal}</td>
                    </tr>
                `;
            }
        });

        html += `
                    </tbody>
                </table>
            </div>
            <div class="mt-2">
                <strong>Total de visitas:</strong> ${visitasDia.length} | 
                <strong>Total de horas:</strong> ${totalHoras.toFixed(1)}h
            </div>
        `;

        relatorioDiv.innerHTML = html;
    }

    gerarRelatorioColaborador() {
        const colaboradorId = parseInt(document.getElementById('select-colaborador').value);
        const relatorioDiv = document.getElementById('relatorio-colaborador');

        const colaborador = this.dados.colaboradores.find(c => c.id === colaboradorId);
        if (!colaborador) {
            relatorioDiv.innerHTML = '<div class="alert alert-danger">Colaborador não encontrado.</div>';
            return;
        }

        const visitasColab = this.dados.visitas.filter(v => v.id_colaborador === colaboradorId);
        if (visitasColab.length === 0) {
            relatorioDiv.innerHTML = '<div class="alert alert-info">Nenhuma visita encontrada para este colaborador.</div>';
            return;
        }

        let html = `
            <h6>Relatório: ${colaborador.nome}</h6>
            <div class="table-responsive">
                <table class="table table-striped">
                    <thead>
                        <tr>
                            <th>Loja</th>
                            <th>Cliente</th>
                            <th>Atividade</th>
                            <th>Horas/Visita</th>
                            <th>Dias da Semana</th>
                            <th>Frequência</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        let totalHoras = 0;
        visitasColab.forEach(visita => {
            const loja = this.dados.lojas.find(l => l.id === visita.id_loja);
            const atividade = this.dados.atividades.find(a => a.id === visita.id_atividade);

            if (loja && atividade) {
                totalHoras += atividade.horas_visita;
                const dias = [];
                if (visita.seg) dias.push('Seg');
                if (visita.ter) dias.push('Ter');
                if (visita.qua) dias.push('Qua');
                if (visita.qui) dias.push('Qui');
                if (visita.sex) dias.push('Sex');
                if (visita.sab) dias.push('Sáb');

                html += `
                    <tr>
                        <td>${loja.nome}</td>
                        <td>${visita.cliente || 'Não informado'}</td>
                        <td>${atividade.nome}</td>
                        <td>${atividade.horas_visita}h</td>
                        <td>${dias.join(', ')}</td>
                        <td>${visita.freq_semanal}</td>
                    </tr>
                `;
            }
        });

        const horasDia = totalHoras / 6;
        const metaMediaDia = this.getMetaMediaDia();
        const eficiencia = metaMediaDia > 0 ? (horasDia / metaMediaDia) * 100 : 0;

        html += `
                    </tbody>
                </table>
            </div>
            <div class="mt-2">
                <strong>Total de visitas:</strong> ${visitasColab.length} | 
                <strong>Total de horas/semana:</strong> ${totalHoras.toFixed(1)}h |
                <strong>Média diária:</strong> ${horasDia.toFixed(1)}h |
                <strong>Eficiência:</strong> <span class="badge ${eficiencia >= 90 ? 'bg-success' : eficiencia >= 70 ? 'bg-warning' : 'bg-danger'}">${eficiencia.toFixed(0)}%</span>
            </div>
        `;

        relatorioDiv.innerHTML = html;
    }

    mostrarMensagem(mensagem, tipo) {
        const container = document.getElementById('import-status');
        const div = document.createElement('div');
        div.className = `alert alert-${tipo} alert-dismissible fade show`;
        div.innerHTML = `
            ${mensagem}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        container.innerHTML = '';
        container.appendChild(div);
        setTimeout(() => { if (div.parentNode) div.remove(); }, 5000);
    }
}

// Classes auxiliares
class ElementFactory {
    static criarLinhaColaborador(colaborador, sistema) {
        const visitasColab = sistema.dados.visitas.filter(v => v.id_colaborador === colaborador.id);
        const lojasAtendidas = [...new Set(visitasColab.map(v => v.id_loja))].length;
        let horasSemana = 0;
        visitasColab.forEach(visita => {
            const atividade = sistema.dados.atividades.find(a => a.id === visita.id_atividade);
            if (atividade) horasSemana += atividade.horas_visita;
        });
        const horasDia = horasSemana / 6;
        const metaMediaDia = sistema.getMetaMediaDia();
        const eficiencia = metaMediaDia > 0 ? (horasDia / metaMediaDia) * 100 : 0;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${colaborador.nome}</td>
            <td>${colaborador.id_agent}</td>
            <td>${lojasAtendidas}</td>
            <td>${horasDia.toFixed(1)}h</td>
            <td>${visitasColab.length}</td>
            <td>
                <span class="badge ${eficiencia >= 90 ? 'bg-success' : eficiencia >= 70 ? 'bg-warning' : 'bg-danger'}">
                    ${eficiencia.toFixed(0)}%
                </span>
            </td>
        `;
        return tr;
    }

    static criarLinhaLoja(loja, sistema) {
        const visitasLoja = sistema.dados.visitas.filter(v => v.id_loja === loja.id);
        const colaboradores = [...new Set(visitasLoja.map(v => v.id_colaborador))].length;
        const visitasSemana = visitasLoja.length;
        let horasSemana = 0;
        const atividadesLoja = [];

        visitasLoja.forEach(visita => {
            const atividade = sistema.dados.atividades.find(a => a.id === visita.id_atividade);
            if (atividade) {
                horasSemana += atividade.horas_visita;
                const atividadeExistente = atividadesLoja.find(a => a.id === atividade.id);
                if (!atividadeExistente) {
                    const dias = [];
                    if (visita.seg) dias.push('Seg');
                    if (visita.ter) dias.push('Ter');
                    if (visita.qua) dias.push('Qua');
                    if (visita.qui) dias.push('Qui');
                    if (visita.sex) dias.push('Sex');
                    if (visita.sab) dias.push('Sáb');
                    atividadesLoja.push({
                        nome: atividade.nome,
                        horas: atividade.horas_visita,
                        frequencia: visita.freq_semanal,
                        dias: dias.join(', '),
                        cliente: visita.cliente || 'Não informado'
                    });
                }
            }
        });

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <strong>${loja.nome}</strong>
                ${loja.cliente ? `<br><small class="text-muted">Cliente: ${loja.cliente}</small>` : ''}
            </td>
            <td>${loja.rede}</td>
            <td>${loja.bairro}</td>
            <td>${loja.municipio}</td>
            <td>${colaboradores}</td>
            <td>${visitasSemana}</td>
            <td>${horasSemana.toFixed(1)}h</td>
            <td>
                <button class="btn btn-sm btn-outline-info btn-ver-atividades" 
                        data-loja-id="${loja.id}"
                        title="Ver atividades">
                    <i class="fas fa-list"></i> ${atividadesLoja.length}
                </button>
            </td>
        `;

        tr.querySelector('.btn-ver-atividades').addEventListener('click', () => {
            sistema.mostrarAtividadesLoja(loja, atividadesLoja);
        });

        return tr;
    }

    // REMOVIDO: criarLinhaAgendaColaborador (agora está no SistemaAtendimento)

    static criarLinhaAgendaLoja(visita, sistema) {
        const loja = sistema.dados.lojas.find(l => l.id === visita.id_loja);
        const atividade = sistema.dados.atividades.find(a => a.id === visita.id_atividade);
        const colaborador = sistema.dados.colaboradores.find(c => c.id === visita.id_colaborador);
        if (!loja || !atividade) return null;

        const tr = document.createElement('tr');
        tr.className = 'store-row store-details';
        tr.innerHTML = `
            <td>
                <div><strong>${loja.nome}</strong></div>
                <small class="text-muted">
                    ${atividade.nome} | 
                    ${visita.cliente ? `Cliente: ${visita.cliente} | ` : ''}
                    ${colaborador?.nome || ''}
                </small>
            </td>
            <td class="day-column">${visita.seg ? '<span class="day-active"><i class="fas fa-check"></i></span>' : ''}</td>
            <td class="day-column">${visita.ter ? '<span class="day-active"><i class="fas fa-check"></i></span>' : ''}</td>
            <td class="day-column">${visita.qua ? '<span class="day-active"><i class="fas fa-check"></i></span>' : ''}</td>
            <td class="day-column">${visita.qui ? '<span class="day-active"><i class="fas fa-check"></i></span>' : ''}</td>
            <td class="day-column">${visita.sex ? '<span class="day-active"><i class="fas fa-check"></i></span>' : ''}</td>
            <td class="day-column">${visita.sab ? '<span class="day-active"><i class="fas fa-check"></i></span>' : ''}</td>
            <td class="text-center">
                ${atividade.horas_visita}h
                <br>
                <small class="text-muted">${visita.freq_semanal}</small>
            </td>
        `;
        return tr;
    }

    static criarLinhaEditorVisita(visita, colaborador, loja, atividade) {
        const tr = document.createElement('tr');
        tr.setAttribute('data-visita-id', visita.id);
        tr.innerHTML = `
            <td>${colaborador.nome}</td>
            <td>
                ${loja.nome}
                ${visita.cliente ? `<br><small class="text-muted">Cliente: ${visita.cliente}</small>` : ''}
            </td>
            <td>${atividade.nome}</td>
            <td class="checkbox-cell"><input type="checkbox" ${visita.seg ? 'checked' : ''} data-field="seg"></td>
            <td class="checkbox-cell"><input type="checkbox" ${visita.ter ? 'checked' : ''} data-field="ter"></td>
            <td class="checkbox-cell"><input type="checkbox" ${visita.qua ? 'checked' : ''} data-field="qua"></td>
            <td class="checkbox-cell"><input type="checkbox" ${visita.qui ? 'checked' : ''} data-field="qui"></td>
            <td class="checkbox-cell"><input type="checkbox" ${visita.sex ? 'checked' : ''} data-field="sex"></td>
            <td class="checkbox-cell"><input type="checkbox" ${visita.sab ? 'checked' : ''} data-field="sab"></td>
            <td><input type="number" class="form-control form-control-sm" value="${atividade.horas_visita}" step="0.5" min="0"></td>
            <td><input type="text" class="form-control form-control-sm" value="${visita.freq_semanal}" placeholder="Frequência"></td>
            <td class="action-buttons">
                <button class="btn btn-sm btn-danger btn-remove-visita"><i class="fas fa-trash"></i></button>
            </td>
        `;
        return tr;
    }
}

class CacheManager {
    constructor() {
        this.cache = new Map();
        this.TEMPO_EXPIRACAO = 5 * 60 * 1000;
    }
    get(chave) {
        const item = this.cache.get(chave);
        if (item && Date.now() - item.timestamp < this.TEMPO_EXPIRACAO) return item.dados;
        this.cache.delete(chave);
        return null;
    }
    set(chave, dados) {
        this.cache.set(chave, { dados, timestamp: Date.now() });
    }
    limpar() { this.cache.clear(); }
}

class NotificationManager {
    constructor(sistema) { this.sistema = sistema; this.notifications = []; }
    verificarAlertas() {
        this.notifications = [];
        this.verificarSobrecarga();
        this.verificarMetas();
    }
    verificarSobrecarga() {
        this.sistema.dados.colaboradores.forEach(colab => {
            const carga = this.sistema.calcularHorasPorDiaColaborador(colab.id);
            if (carga > 10) {
                this.adicionarNotificacao(
                    `⚠️ ${colab.nome} está sobrecarregado: ${carga.toFixed(1)}h/dia`,
                    'alerta',
                    'show-overloaded',
                    colab.id
                );
            }
        });
    }
    verificarMetas() {
        const metaMedia = this.sistema.getMetaMediaDia();
        this.sistema.dados.colaboradores.forEach(colab => {
            const horasDia = this.sistema.calcularHorasPorDiaColaborador(colab.id);
            const eficiencia = (horasDia / metaMedia) * 100;
            if (eficiencia < 60) {
                this.adicionarNotificacao(
                    `📉 ${colab.nome} está com baixa eficiência: ${eficiencia.toFixed(0)}%`,
                    'alerta',
                    'show-underperforming',
                    colab.id
                );
            }
        });
    }
    adicionarNotificacao(mensagem, tipo, acao, colaboradorId = null) {
        this.notifications.push({ mensagem, tipo, acao, colaboradorId, timestamp: new Date() });
    }
    mostrarAlertasUI(container) {
        if (this.notifications.length === 0) {
            container.innerHTML = '<div class="analise-item sucesso"><p><i class="fas fa-check-circle me-2"></i>Nenhum alerta crítico detectado</p></div>';
            return;
        }
        let html = '';
        this.notifications.forEach((notif, index) => {
            html += `
                <div class="analise-item ${notif.tipo}" 
                      data-action="${notif.acao}"
                      ${notif.colaboradorId ? `data-colaborador="${notif.colaboradorId}"` : ''}>
                    <h6><i class="fas fa-bell me-2"></i>Alerta ${index + 1}</h6>
                    <p>${notif.mensagem}</p>
                    <small class="text-muted">${this.formatarTempo(notif.timestamp)}</small>
                </div>
            `;
        });
        container.innerHTML = html;
        const alertItems = container.querySelectorAll('.analise-item[data-action]');
        alertItems.forEach(item => {
            item.addEventListener('click', () => {
                const action = item.getAttribute('data-action');
                const colaboradorId = item.getAttribute('data-colaborador');
                this.sistema.handleAlertClick(action, colaboradorId);
            });
        });
    }
    formatarTempo(timestamp) {
        const agora = new Date();
        const diferenca = agora - new Date(timestamp);
        const minutos = Math.floor(diferenca / 60000);
        if (minutos < 1) return 'Agora mesmo';
        if (minutos < 60) return `Há ${minutos} minuto${minutos > 1 ? 's' : ''}`;
        const horas = Math.floor(minutos / 60);
        return `Há ${horas} hora${horas > 1 ? 's' : ''}`;
    }
}

class BackupManager {
    constructor(sistema) { this.sistema = sistema; }
    fazerBackup() {
        try {
            const dados = JSON.stringify(this.sistema.dados, null, 2);
            const blob = new Blob([dados], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `backup-atendimento-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            this.sistema.mostrarMensagem('Backup criado com sucesso!', 'success');
        } catch (error) {
            this.sistema.mostrarMensagem(`Erro ao criar backup: ${error.message}`, 'danger');
        }
    }
}

class OtimizadorRota {
    constructor(sistema) { this.sistema = sistema; }
    async otimizarRotas(colaboradorId) {
        const visitas = this.sistema.dados.visitas.filter(v => v.id_colaborador === colaboradorId);
        const lojasIds = [...new Set(visitas.map(v => v.id_loja))];
        const lojas = lojasIds.map(id => this.sistema.dados.lojas.find(l => l.id === id)).filter(Boolean);
        const lojasOrdenadas = this.ordenarPorProximidade(lojas);
        return {
            lojas: lojasOrdenadas,
            distanciaTotal: this.calcularDistanciaTotal(lojasOrdenadas),
            tempoEstimado: this.calcularTempoEstimado(lojasOrdenadas)
        };
    }
    ordenarPorProximidade(lojas) {
        return lojas.sort((a, b) => {
            if (a.municipio !== b.municipio) return a.municipio.localeCompare(b.municipio);
            return a.bairro.localeCompare(b.bairro);
        });
    }
    calcularDistanciaTotal(lojas) { return (lojas.length * 5).toFixed(1); }
    calcularTempoEstimado(lojas) {
        const tempoVisitas = lojas.length * 0.5;
        const tempoDeslocamento = (lojas.length - 1) * 0.25;
        const totalHoras = tempoVisitas + tempoDeslocamento;
        const horas = Math.floor(totalHoras);
        const minutos = Math.round((totalHoras - horas) * 60);
        return `${horas > 0 ? `${horas}h ` : ''}${minutos}min`;
    }
}

class FiltroAvancado {
    constructor(sistema) { this.sistema = sistema; }
}

class ValidadorDados {
    validarColaborador(colaborador) {
        const erros = [];
        if (!colaborador.nome || colaborador.nome.trim().length < 2) erros.push('Nome deve ter pelo menos 2 caracteres');
        if (!colaborador.id_agent) erros.push('ID do agente é obrigatório');
        return erros;
    }
    validarVisita(visita) {
        const erros = [];
        if (!visita.id_colaborador) erros.push('Colaborador é obrigatório');
        if (!visita.id_loja) erros.push('Loja é obrigatória');
        if (!visita.id_atividade) erros.push('Atividade é obrigatória');
        const dias = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
        const temDiaSelecionado = dias.some(dia => visita[dia]);
        if (!temDiaSelecionado) erros.push('Pelo menos um dia da semana deve ser selecionado');
        return erros;
    }
}

class AnalisePreditiva {
    constructor(sistema) { this.sistema = sistema; }
}

class Debouncer {
    constructor(delay = 300) { this.delay = delay; this.timeoutId = null; }
    executar(funcao) {
        clearTimeout(this.timeoutId);
        this.timeoutId = setTimeout(funcao, this.delay);
    }
    cancelar() { clearTimeout(this.timeoutId); }
}

// Inicializar o sistema
let sistema;
document.addEventListener('DOMContentLoaded', () => {
    sistema = new SistemaAtendimento();
});