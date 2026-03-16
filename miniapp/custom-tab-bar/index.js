Component({
  data: {
    selected: 0,
    color: '#94a3b8',
    selectedColor: '#4f46e5',
    list: [
      {
        pagePath: '/pages/index/index',
        text: '工作台',
        iconPath: '/assets/tab-home.svg',
        selectedIconPath: '/assets/tab-home-active.svg'
      },
      {
        pagePath: '/pages/profile/profile',
        text: '我的',
        iconPath: '/assets/tab-user.svg',
        selectedIconPath: '/assets/tab-user-active.svg'
      }
    ]
  },

  lifetimes: {
    attached() {
      this.syncSelected()
    }
  },

  pageLifetimes: {
    show() {
      this.syncSelected()
    }
  },

  methods: {
    syncSelected() {
      const pages = getCurrentPages()
      const current = pages[pages.length - 1]
      const route = current && (current.route || current.__route__)
      if (!route) return
      const currentPath = `/${route}`
      const selected = this.data.list.findIndex((item) => item.pagePath === currentPath)
      if (selected >= 0 && selected !== this.data.selected) {
        this.setData({ selected })
      }
    },

    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index)
      const item = this.data.list[index]
      if (!item) return
      if (index === this.data.selected) return
      this.setData({ selected: index })
      wx.switchTab({ url: item.pagePath })
    }
  }
})
