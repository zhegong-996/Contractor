function taskDraft(project = '') {
  return { title: '', request: '', target: '', material: [], resources: [], repository: '', topic: '', priority: 'normal', project, parent: undefined, nonce: '',
    measure: { metric: '', unit: '', baseline: '', target: '' }, reusedLesson: null };
}
function observationDraft() {
  return { actual: '', evidence: '', body: '', conditions: '', nonce: '' };
}

Vue.createApp({
  data() {
    return {
      workspace: null, view: 'inbox', projectId: '', ticket: null, ticketId: '',
      tabs: [{ id: 'inbox', title: '协作' }, { id: 'project', title: '项目' }, { id: 'team', title: '团队 Agent' }, { id: 'knowledge', title: '知识' }],
      credentials: { username: '', password: '' },
      draft: taskDraft(), observation: observationDraft(), observing: false,
      ciText: { passed: '已通过', pending: '等待结果', failed: '失败' }, deliveryUrl: '', branchUrl: '',
      review: { body: '', conditions: '' }, answers: {}, materials: [],
      entries: [], query: '', focusedEntry: '', adding: false,
      newEntry: { title: '', body: '', conditions: '', kind: 'reference', visibility: 'restricted' },
      accessTitles: { requested: '待授权', granted: '本工单已授权', revoked: '已撤回', expired: '已过期' },
      channels: { accounts: [], proofs: [], pending: [] }, proofCommands: {}, channelTargets: {}, channelTopics: {},
      referenceOpen: false, newReference: { source: 'feishu-doc', label: '', url: '', revision: '' },
      topicOpen: false, newTopic: '', newTopicParent: '', focusedTopic: '', relatedTarget: '',
      prStates: { open: '开启', draft: '草稿', closed: '已关闭', merged: '已合并' },
      issueReasons: { completed: '已完成', not_planned: '暂无计划', duplicate: '重复' },
      resourcePurposes: { discussion: '讨论入口', reference: '参考资料', delivery: '交付仓库' },
      runTitles: { done: '已完成', nothing: '无进一步动作', queued: '排队中', claimed: '执行中', cancelled: '已停止' },
      back: { view: 'inbox', y: 0 }, error: '', notice: '', busy: false, timer: null,
    };
  },
  computed: {
    project() { return this.workspace?.projects.find(p => p.id === this.projectId); },
    parentProject() { return this.workspace?.projects.find(p => p.id === this.project?.parent); },
    supportingResources() { return this.project?.resources.filter(ref => ref.state === 'bound') ?? []; },
    selectedAgent() {
      const [kind, name] = this.draft.target.split(':');
      return this.projectAgents.find(agent => agent.id === (kind === 'agent' ? name : this.availableFunctions.find(fn => fn.id === name)?.lead));
    },
    attention() { return this.workspace?.tickets.filter(t => t.attention) ?? []; },
    projectTickets() { return this.workspace.tickets.filter(t => t.work.project === this.projectId); },
    topTopics() { return this.project?.topics.filter(topic => !topic.parent) ?? []; },
    topicOptions() { return this.topTopics.flatMap(topic => [topic, ...this.subtopicsOf(topic.id)]); },
    selectedTopic() { return this.project?.topics.find(topic => topic.id === this.focusedTopic); },
    topicGroups() {
      const topics = this.topicOptions;
      const groups = topics.map(topic => ({ ...topic, tickets: this.projectTickets.filter(item => item.work.topic === topic.id) }));
      if (this.selectedTopic) return groups.filter(group => group.id === this.focusedTopic || group.parent === this.focusedTopic);
      const known = new Set(topics.map(topic => topic.id));
      return [
        ...groups,
        { id: '', title: '未归入主题', tickets: this.projectTickets.filter(item => !known.has(item.work.topic)) },
      ].filter(topic => topic.tickets.length);
    },
    subprojects() { return this.workspace?.projects.filter(item => item.parent === this.projectId) ?? []; },
    projectAgents() { return this.workspace.agents.filter(a => a.projects.includes(this.projectId)); },
    availableFunctions() { return this.workspace.functions.filter(fn => this.projectAgents.some(a => a.active && a.id === fn.lead)); },
    groups() {
      return this.workspace.functions.map(fn => ({ ...fn, agents: this.projectAgents.filter(a => a.function === fn.id) }))
        .filter(fn => fn.agents.length);
    },
    pageTitle() {
      if (this.view === 'ticket') return this.ticket?.title ?? '工单';
      if (this.view === 'create') return '发起协作';
      if (this.view === 'accounts') return '渠道账号';
      return this.tabs.find(tab => tab.id === this.view)?.title;
    },
  },
  mounted() {
    void this.api('session').then(session => { if (session.signedIn) return this.refresh(); })
      .catch(error => { this.error = error.message; });
    this.timer = setInterval(() => {
      if (this.workspace && !this.busy && !document.hidden) void this.refresh();
    }, 2500);
  },
  beforeUnmount() { clearInterval(this.timer); },
  methods: {
    async api(route, data = undefined) {
      const response = await fetch('/api/' + route, data === undefined ? {} : {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
      });
      const payload = await response.json();
      if (!response.ok) {
        const error = new Error(payload.error);
        error.status = response.status;
        throw error;
      }
      return payload;
    },
    async act(task) {
      if (this.busy) return;
      this.busy = true;
      this.error = '';
      this.notice = '';
      try { await task(); } catch (error) { this.error = error.message; }
      finally { this.busy = false; }
    },
    async login() {
      await this.act(async () => {
        await this.api('login', this.credentials);
        await this.refresh();
      });
      this.credentials.password = '';
    },
    async logout() {
      await this.act(async () => {
        await this.api('logout', {});
        this.clearSession();
      });
    },
    clearSession() {
      this.workspace = null;
      this.view = 'inbox';
      this.projectId = '';
      this.ticket = null;
      this.ticketId = '';
      this.draft = taskDraft();
      this.observation = observationDraft();
      this.observing = false;
      this.answers = {};
      this.entries = [];
      this.channels = { accounts: [], proofs: [], pending: [] };
      this.proofCommands = {};
      this.channelTargets = {};
      this.channelTopics = {};
      this.referenceOpen = false;
      this.topicOpen = false;
      this.newTopic = '';
      this.newTopicParent = '';
      this.focusedTopic = '';
      this.relatedTarget = '';
      this.newReference = { source: 'feishu-doc', label: '', url: '', revision: '' };
      this.materials = [];
      this.query = '';
      this.focusedEntry = '';
      this.adding = false;
      this.newEntry = { title: '', body: '', conditions: '', kind: 'reference', visibility: 'restricted' };
    },
    async refresh() {
      try {
        const result = await this.api('overview');
        this.workspace = result;
        if (result.crossChannel && ['inbox', 'project', 'accounts'].includes(this.view)) {
          this.channels = await this.api('channels');
          for (const provider of Object.keys(this.proofCommands))
            if (!this.channels.proofs.some(proof => proof.provider === provider)) delete this.proofCommands[provider];
        }
        if (!result.projects.some(p => p.id === this.projectId)) {
          this.projectId = result.projects[0]?.id ?? '';
          this.focusedTopic = '';
        }
        if (this.view === 'ticket' && this.ticketId) {
          const id = this.ticketId;
          const ticket = await this.api('ticket/' + id);
          if (this.ticketId === id && this.view === 'ticket') this.ticket = ticket;
        }
      } catch (error) {
        if (error.status === 401) this.clearSession();
        else this.error = error.message;
      }
    },
    agentName(id) { return this.workspace.agents.find(a => a.id === id)?.title ?? '项目 Agent'; },
    sourceName(source) { return { feishu: '飞书', github: 'GitHub', figma: 'Figma', 'feishu-doc': '飞书文档', document: '外部文档' }[source] ?? source; },
    engineName(engine) { return { codex: 'Codex', cursor: 'Cursor', claude: 'Claude Code', acp: 'ACP', command: 'CLI' }[engine] ?? engine; },
    functionName(id) { return this.workspace.functions.find(fn => fn.id === id)?.title ?? id; },
    subtopicsOf(id) { return this.project?.topics.filter(topic => topic.parent === id) ?? []; },
    topicLabel(topic, topics = this.project?.topics ?? []) {
      const parent = topics.find(item => item.id === topic.parent);
      return parent ? parent.title + ' / ' + topic.title : topic.title;
    },
    topicCount(id) {
      const included = new Set([id, ...this.subtopicsOf(id).map(topic => topic.id)]);
      return this.projectTickets.filter(item => included.has(item.work.topic)).length;
    },
    githubName(actor) { return actor ? [actor.member, '@' + actor.login, actor.type === 'Bot' ? 'Bot' : ''].filter(Boolean).join(' · ') : '未核实'; },
    stateOf(ticket) {
      if (ticket.needsObservation || (ticket.work.accepted && ticket.work.measure && ticket.result
          && ticket.work.requester === this.workspace.actor && ticket.observations?.length === 0)) return '待记录结果';
      if (ticket.work.accepted) return '已验收';
      if (ticket.result) return '待验收';
      if (ticket.nextReview || ticket.timers?.length) return '等待复查';
      if (ticket.questions?.length || ticket.stage?.action === 'answer') return '待答复';
      if (ticket.blocked || ticket.stage?.action === 'blocked') return '待处理';
      if (ticket.stage?.stage === 'ended') return '已结束';
      if (ticket.waitingAccess || ticket.requests?.some(request => request.state === 'requested')) return '待授权';
      return ticket.stage?.action === 'queued' ? '待执行' : '执行中';
    },
    async go(view) {
      this.view = view;
      this.error = '';
      this.notice = '';
      if (view === 'knowledge') await this.loadKnowledge();
      if (view === 'accounts') await this.refresh();
    },
    async selectProject(id) {
      if (id !== this.projectId) {
        this.focusedTopic = '';
        this.newTopicParent = '';
      }
      this.projectId = id;
      this.query = '';
      await this.go('project');
    },
    async showTopic(id) {
      this.focusedTopic = id;
      await this.go('inbox');
      this.$nextTick(() => document.getElementById('project-work')?.scrollIntoView());
    },
    async openTicket(id, remember = true) {
      if (remember) this.back = { view: this.view, y: window.scrollY };
      const ticket = await this.api('ticket/' + id).catch(error => { this.error = error.message; });
      if (!ticket) return;
      if (this.ticketId !== id) {
        this.review = { body: '', conditions: '' };
        this.observation = observationDraft();
        this.observing = false;
        this.deliveryUrl = ticket.work.delivery?.url ?? '';
        this.branchUrl = '';
        this.relatedTarget = '';
      }
      this.ticketId = id;
      this.ticket = ticket;
      if (this.projectId !== ticket.project) this.focusedTopic = '';
      this.projectId = ticket.project;
      this.view = 'ticket';
      window.scrollTo(0, 0);
    },
    async bindResource(ref) {
      await this.act(async () => {
        await this.api('project/' + this.projectId + '/bind', { source: ref.source, externalId: ref.externalId });
        await this.refresh();
      });
    },
    async addReference() {
      await this.act(async () => {
        const { source, label, url, revision } = this.newReference;
        await this.api('project/' + this.projectId + '/reference', { source, label, url, revision: revision || undefined });
        this.referenceOpen = false;
        this.newReference = { source: 'feishu-doc', label: '', url: '', revision: '' };
        await this.refresh();
      });
    },
    async addTopic() {
      await this.act(async () => {
        await this.api('project/' + this.projectId + '/topic', { id: 'topic-' + crypto.randomUUID(), title: this.newTopic,
          parent: this.newTopicParent || undefined });
        this.topicOpen = false;
        this.newTopic = '';
        this.newTopicParent = '';
        await this.refresh();
      });
    },
    async setAgent(agent) {
      if (agent.active && !window.confirm('停用后会停止这个 Agent 的在途工单。确定停用？')) return;
      await this.act(async () => {
        await this.api('agent/' + agent.id, { active: !agent.active });
        await this.refresh();
      });
    },
    async openComposer(agent = '', parent = undefined) {
      this.back = { view: this.view, y: window.scrollY };
      if (this.draft.project !== this.projectId || (this.draft.reusedLesson && this.draft.parent !== parent)) {
        this.draft = taskDraft(this.projectId);
      }
      this.draft.nonce ||= crypto.randomUUID();
      this.draft.parent = parent;
      if (parent) this.draft.topic = this.ticket?.work.topic ?? '';
      else if (!this.draft.topic) this.draft.topic = this.selectedTopic?.id ?? '';
      if (agent) this.draft.target = 'agent:' + agent;
      this.view = 'create';
      try {
        this.materials = (await this.api('knowledge/' + this.projectId)).filter(e => e.state === 'published');
      } catch (error) { this.error = error.message; }
    },
    async reuse(entry) {
      const { metric, unit, baseline } = entry.learning;
      if (this.draft.reusedLesson?.id !== entry.id || this.draft.project !== this.projectId) {
        this.draft = {
          ...taskDraft(this.projectId), title: entry.title.slice(0, 95) + ' · 复查', parent: entry.ticket,
          material: [entry.id], measure: { metric, unit, baseline, target: '' },
          reusedLesson: { id: entry.id, title: entry.title },
        };
      }
      await this.openComposer('', entry.ticket);
    },
    measurePayload() {
      const { metric, unit, baseline, target } = this.draft.measure;
      if (!metric && !unit && baseline === '' && target === '') return undefined;
      if (!metric || !unit) throw new Error('请填写观测指标和单位。');
      return { metric, unit, ...(baseline === '' ? {} : { baseline }), ...(target === '' ? {} : { target }) };
    },
    startObservation() {
      this.observation.nonce ||= crypto.randomUUID();
      this.observing = true;
    },
    async recordObservation() {
      await this.act(async () => {
        const { actual, evidence, body, conditions, nonce } = this.observation;
        if (body.trim() && !conditions.trim()) throw new Error('请填写经验的适用条件。');
        await this.api('ticket/' + this.ticket.id + '/observation', {
          revision: this.ticket.work.accepted.revision, actual, evidence, nonce,
          ...(body.trim() ? { lesson: { body, conditions } } : {}),
        });
        this.observation = observationDraft();
        this.observing = false;
        await this.refresh();
      });
    },
    changeFrom(value, baseline) {
      return Intl.NumberFormat('zh-CN', { signDisplay: 'exceptZero', maximumFractionDigits: 6 }).format(value - baseline);
    },
    async restoreView() {
      const { view, y } = this.back;
      this.view = ['inbox', 'project', 'team', 'ticket', 'knowledge', 'accounts'].includes(view) ? view : 'inbox';
      if (this.view === 'knowledge') await this.loadKnowledge();
      this.$nextTick(() => window.scrollTo(0, y));
    },
    async submitTask() {
      await this.act(async () => {
        const [kind, target] = this.draft.target.split(':');
        const { title, request, material, resources, repository, topic, priority, project, parent, nonce } = this.draft;
        const data = await this.api('ticket', { title, request, material, resources, priority, project, parent, nonce,
          topic: topic || undefined,
          target: ['codex','cursor'].includes(this.selectedAgent?.engine) ? repository || undefined : undefined,
          measure: this.measurePayload(), reusedLesson: this.draft.reusedLesson?.id,
          ...(kind === 'agent' ? { agent: target } : { function: target }) });
        for (let retry = 0; retry < 15; retry++) {
          const { ticket } = await this.api('request/' + data.trigger);
          if (ticket) {
            this.draft = taskDraft();
            if (this.back.view === 'ticket') this.back = { view: 'inbox', y: 0 };
            await this.openTicket(ticket, false);
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        this.notice = '委托已接收。可在协作列表刷新查看。';
        await this.restoreView();
      });
    },
    async answer(id, choice) {
      await this.act(async () => {
        await this.api('ticket/' + this.ticket.id + '/answer', { card: id, choice,
          ...(choice === undefined ? { text: this.answers[id] } : {}), nonce: crypto.randomUUID() });
        delete this.answers[id];
        await this.refresh();
      });
    },
    async access(request, state) {
      await this.act(async () => {
        await this.api('ticket/' + this.ticket.id + '/access/' + request.id, { state });
        await this.refresh();
      });
    },
    async stop() {
      await this.act(async () => {
        await this.api('ticket/' + this.ticket.id + '/stop', {});
        await this.refresh();
      });
    },
    async linkDelivery() {
      await this.act(async () => {
        await this.api('ticket/' + this.ticket.id + '/delivery', { url: this.deliveryUrl });
        await this.refresh();
      });
    },
    async linkBranch() {
      await this.act(async () => {
        await this.api('ticket/' + this.ticket.id + '/branch', { url: this.branchUrl });
        this.branchUrl = '';
        await this.refresh();
      });
    },
    branchLink(branch) {
      return 'https://github.com/' + branch.repository + '/tree/' + branch.name.split('/').map(encodeURIComponent).join('/');
    },
    async beginChannel(provider) {
      await this.act(async () => {
        const proof = await this.api('channels/proof', { provider });
        this.proofCommands[provider] = proof.command;
        await this.refresh();
      });
    },
    async confirmChannel(proof) {
      await this.act(async () => {
        const { provider, namespace, id } = proof.sender;
        await this.api('channels/confirm', { provider, namespace, id });
        delete this.proofCommands[provider];
        await this.refresh();
      });
    },
    async unlinkChannel(account) {
      await this.act(async () => {
        const { provider, namespace, id } = account;
        await this.api('channels/unlink', { provider, namespace, id });
        await this.refresh();
      });
    },
    async resolveChannel(item, action) {
      await this.act(async () => {
        const result = await this.api('channels/' + item.id + '/resolve', {
          action, ...(action === 'link' ? { ticket: this.channelTargets[item.id] } : {}),
          ...(action === 'create' && this.channelTopics[item.id] ? { topic: this.channelTopics[item.id] } : {}),
        });
        delete this.channelTargets[item.id];
        delete this.channelTopics[item.id];
        await this.refresh();
        if (result.ticket) await this.openTicket(result.ticket);
      });
    },
    async setTopic(topic) {
      await this.act(async () => {
        await this.api('ticket/' + this.ticket.id + '/topic', { topic: topic || undefined });
        await this.refresh();
      });
    },
    async relateWork() {
      await this.act(async () => {
        await this.api('ticket/' + this.ticket.id + '/related', { ticket: this.relatedTarget });
        this.relatedTarget = '';
        await this.refresh();
      });
    },
    async accept() {
      await this.act(async () => {
        await this.api('ticket/' + this.ticket.id + '/accept', { ...this.review, revision: this.ticket.result.revision, commit: this.ticket.work.delivery?.headSha });
        await this.refresh();
      });
    },
    async showLesson(id) {
      this.query = '';
      this.focusedEntry = id;
      await this.go('knowledge');
      await this.$nextTick();
      const entry = document.getElementById('knowledge-' + id);
      entry?.scrollIntoView({ block: 'nearest' });
      entry?.querySelector('summary')?.focus({ preventScroll: true });
    },
    async loadKnowledge() {
      if (!this.projectId) return;
      try { this.entries = await this.api('knowledge/' + this.projectId + '?q=' + encodeURIComponent(this.query)); }
      catch (error) { this.error = error.message; }
    },
    async saveKnowledge() {
      await this.act(async () => {
        await this.api('knowledge/' + this.projectId, this.newEntry);
        this.newEntry = { title: '', body: '', conditions: '', kind: 'reference', visibility: 'restricted' };
        this.adding = false;
        await this.loadKnowledge();
      });
    },
    async publish(entry) {
      await this.act(async () => {
        await this.api('knowledge/' + entry.id + '/publish', { revision: entry.revision });
        await this.loadKnowledge();
      });
    },
  },
}).mount('#app');
