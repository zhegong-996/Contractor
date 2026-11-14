Vue.createApp({
  data() {
    return {
      workspace: null, view: 'inbox', projectId: '', ticket: null, ticketId: '',
      tabs: [{ id: 'inbox', title: '协作' }, { id: 'project', title: '项目' }, { id: 'team', title: '团队 Agent' }, { id: 'knowledge', title: '知识' }],
      credentials: { username: '', password: '' },
      draft: { title: '', request: '', target: '', material: [], priority: 'normal', project: '', parent: undefined, nonce: '' },
      ciText: { passed: '已通过', pending: '等待结果', failed: '失败' }, deliveryUrl: '',
      review: { body: '', conditions: '' }, answers: {}, materials: [],
      entries: [], query: '', adding: false,
      newEntry: { title: '', body: '', conditions: '', kind: 'reference', visibility: 'restricted' },
      accessTitles: { requested: '待授权', granted: '本工单已授权', revoked: '已撤回', expired: '已过期' },
      runTitles: { done: '已完成', nothing: '无进一步动作', queued: '排队中', claimed: '执行中', cancelled: '已停止' },
      back: { view: 'inbox', y: 0 }, error: '', notice: '', busy: false, timer: null,
    };
  },
  computed: {
    project() { return this.workspace?.projects.find(p => p.id === this.projectId); },
    attention() { return this.workspace?.tickets.filter(t => t.attention) ?? []; },
    projectTickets() { return this.workspace.tickets.filter(t => t.work.project === this.projectId); },
    projectAgents() { return this.workspace.agents.filter(a => a.projects.includes(this.projectId)); },
    availableFunctions() { return this.workspace.functions.filter(fn => this.projectAgents.some(a => a.active && a.id === fn.lead)); },
    groups() {
      return this.workspace.functions.map(fn => ({ ...fn, agents: this.projectAgents.filter(a => a.function === fn.id) }))
        .filter(fn => fn.agents.length);
    },
    pageTitle() {
      if (this.view === 'ticket') return this.ticket?.title ?? '工单';
      if (this.view === 'create') return '发起协作';
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
        this.workspace = null;
        this.ticket = null;
        this.ticketId = '';
        this.view = 'inbox';
      });
    },
    async refresh() {
      try {
        const result = await this.api('overview');
        this.workspace = result;
        if (!result.projects.some(p => p.id === this.projectId)) this.projectId = result.projects[0]?.id ?? '';
        if (this.view === 'ticket' && this.ticketId) {
          const id = this.ticketId;
          const ticket = await this.api('ticket/' + id);
          if (this.ticketId === id && this.view === 'ticket') this.ticket = ticket;
        }
      } catch (error) {
        if (error.status === 401) { this.workspace = null; this.ticket = null; }
        else this.error = error.message;
      }
    },
    agentName(id) { return this.workspace.agents.find(a => a.id === id)?.title ?? '项目 Agent'; },
    sourceName(source) { return { feishu: '飞书', github: 'GitHub', figma: 'Figma' }[source] ?? source; },
    stateOf(ticket) {
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
    },
    async selectProject(id) {
      this.projectId = id;
      this.query = '';
      if (this.view === 'ticket' || this.view === 'create') await this.go('project');
      if (this.view === 'knowledge') await this.loadKnowledge();
    },
    async openTicket(id, remember = true) {
      if (remember) this.back = { view: this.view, y: window.scrollY };
      const ticket = await this.api('ticket/' + id).catch(error => { this.error = error.message; });
      if (!ticket) return;
      if (this.ticketId !== id) {
        this.review = { body: '', conditions: '' };
        this.deliveryUrl = ticket.work.delivery?.url ?? '';
      }
      this.ticketId = id;
      this.ticket = ticket;
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
    async setAgent(agent) {
      if (agent.active && !window.confirm('停用后会停止这个 Agent 的在途工单。确定停用？')) return;
      await this.act(async () => {
        await this.api('agent/' + agent.id, { active: !agent.active });
        await this.refresh();
      });
    },
    async openComposer(agent = '', parent = undefined) {
      this.back = { view: this.view, y: window.scrollY };
      if (this.draft.project !== this.projectId) this.draft = {
        title: '', request: '', target: '', material: [], priority: 'normal', project: this.projectId, parent, nonce: crypto.randomUUID(),
      };
      this.draft.parent = parent;
      if (agent) this.draft.target = 'agent:' + agent;
      this.view = 'create';
      this.materials = (await this.api('knowledge/' + this.projectId)).filter(e => e.state === 'published');
    },
    async restoreView() {
      const { view, y } = this.back;
      this.view = ['inbox', 'project', 'team', 'ticket', 'knowledge'].includes(view) ? view : 'inbox';
      if (this.view === 'knowledge') await this.loadKnowledge();
      this.$nextTick(() => window.scrollTo(0, y));
    },
    async submitTask() {
      await this.act(async () => {
        const [kind, target] = this.draft.target.split(':');
        const { title, request, material, priority, project, parent, nonce } = this.draft;
        const data = await this.api('ticket', { title, request, material, priority, project, parent, nonce,
          ...(kind === 'agent' ? { agent: target } : { function: target }) });
        for (let retry = 0; retry < 15; retry++) {
          const { ticket } = await this.api('request/' + data.trigger);
          if (ticket) {
            this.draft = { title: '', request: '', target: '', material: [], priority: 'normal', project: '', parent: undefined, nonce: '' };
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
    async accept() {
      await this.act(async () => {
        await this.api('ticket/' + this.ticket.id + '/accept', { ...this.review, revision: this.ticket.result.revision, commit: this.ticket.work.delivery?.headSha });
        await this.refresh();
      });
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
