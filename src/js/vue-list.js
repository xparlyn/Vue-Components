(function(context, definition) {
	'use strict';
	if (typeof define === 'function' && define.amd) {
		define(['Vue', 'VueUtil'], definition);
	} else {
		context.VueList = definition(context.Vue, context.VueUtil);
		delete context.VueList;
	}
})(this, function(Vue, VueUtil) {
	'use strict';
	var VueList = {
		name: 'VueList',
		componentName: 'VueList',
		data: function(){
			return {
				activedIndex: null,
				remain: 0,
				size: 20,
				delta: {
					start: 0,
					end: 0,
					total: 0,
					keeps: 0,
					allPadding: 0,
					paddingTop: 0,
					setFlg: false
				}
			}
		},
		props: {
			height: {
				type: Number,
				default: 200
			},
			onScroll: Function,
			defaultActivedIndex: {
				type: Number,
				default: 0
			},
			defaultSelected: {
				type: Boolean,
				default: true
			}
		},
		methods: {
			setItemIndex: function(item) {
				item.index = this.$slots.default.indexOf(item.$vnode);
			},
			handleItemClick: function(itemObj) {
				this.activedIndex = itemObj.index;
			},
			handleScroll: function(e) {
				var scrollTop = this.$refs.container.scrollTop;
				this.updateZone(scrollTop);
				if (this.onScroll) {
					this.onScroll(e, scrollTop);
				}
			},
			updateZone: function(offset) {
				var delta = this.delta;
				if (delta.total <= delta.keeps) return;
				var overs = Math.floor(offset / this.size);
				if (!offset) {
					this.$emit('toTop');
				}
				var start = overs ? overs : 0;
				var end = overs ? (overs + delta.keeps) : delta.keeps;
				if (overs + delta.keeps >= delta.total) {
					end = delta.total;
					start = delta.total - delta.keeps;
					this.$emit('toBottom');
				}
				delta.end = end;
				delta.start = start;
			},
			filter: function(slots) {
				var delta = this.delta;
				if (delta.keeps === 0 || slots.length <= delta.keeps) {
					delta.paddingTop = 0;
					delta.allPadding = 0;
					return slots;
				}
				delta.total = slots.length;
				delta.paddingTop = this.size * delta.start;
				delta.allPadding = this.size * (slots.length - delta.keeps);
				delta.paddingTop < 0 ? delta.paddingTop = 0 : void 0;
				delta.allPadding < 0 ? delta.allPadding = 0 : void 0;
				delta.allPadding < delta.paddingTop ? delta.allPadding = delta.paddingTop : void 0;
				var result = [];
				for (var i = delta.start, j = delta.end; i < j; i++) {
					result.push(slots[i]);
				}
				return result;
			},
			init: function() {
				var slots = this.$slots.default;
				var delta = this.delta;
				this.remain = Math.round(this.height*1 / this.size);
				delta.end = this.remain;
				delta.keeps = this.remain;
				if (slots && slots.length <= this.remain) {
					delta.end = slots.length;
					delta.keeps = slots.length;
				}
				delta.setFlg = true;
				this.updateZone(0);
			}
		},
		render: function(createElement) {
			var slots = this.$slots.default;
			var delta = this.delta;
			if (slots && !delta.setFlg) {
				this.init();
			}
			var showList = this.filter(slots);
			var paddingTop = delta.paddingTop;
			var allPadding = delta.allPadding;
			return createElement('div', {
				'ref': 'container',
				'class': ['vue-list'],
				'style': {
					'height': this.height*1 + 'px'
				},
				'on': {
					'scroll': this.handleScroll
				}
			}, [
				createElement('div', {
					'style': {
						'padding-top': paddingTop + 'px',
						'padding-bottom': allPadding - paddingTop + 'px'
					}
				}, showList)
			]);
		},
		mounted: function() {
			var self = this;
			self.$on('item-click', self.handleItemClick);
			if (self.defaultSelected) {
				self.$nextTick(function(){
					self.$slots.default[self.defaultActivedIndex].componentInstance.handleClick();
				});
			}
		}
	};
	Vue.component(VueList.name, VueList);
});
