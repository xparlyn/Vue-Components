!(function(name, context, definition) {
	'use strict';
	if (typeof define === 'function' && define.amd) {
		define(['Vue'], definition);
	} else {
		context[name] = definition(context['Vue']);
		delete context[name];
	}
})('VueTag', this, function(Vue) {
	'use strict';
	var VueTag = {
		template: '<transition name="vue-zoom-in-center" v-if="transition"><span class="vue-tag" :class="[type ? \'vue-tag--\' + type : \'\', {\'is-hit\': hit}]"><slot></slot><i class="vue-tag__close vue-icon-close" v-if="closable" @click="handleClose"></i></span></transition><span v-else class="vue-tag" :class="[type ? \'vue-tag--\' + type : \'\', {\'is-hit\': hit}]"><slot></slot><i class="vue-tag__close vue-icon-close" v-if="closable" @click="handleClose"></i></span>',
		name: 'VueTag',
		props: {
			text: String,
			closable: Boolean,
			type: String,
			hit: Boolean,
			transition: {
				type: Boolean,
				default: false
			}
		},
		methods: {
			handleClose: function(event) {
				this.$emit('close', event);
			}
		}
	};
	Vue.component(VueTag.name, VueTag);
});
