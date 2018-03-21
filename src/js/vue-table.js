(function(context, definition) {
	'use strict';
	if (typeof define === 'function' && define.amd) {
		define(['Vue', 'VueUtil', 'VuePopper'], definition);
	} else {
		context.VueTable = definition(context.Vue, context.VueUtil, context.VuePopper);
		delete context.VueTable;
	}
})(this, function(Vue, VueUtil, VuePopper) {
	'use strict';
	var TableStore = function(table, initialState) {
		this.table = table;
		this.states = {
			_columns: [],
			columns: [],
			labelColumns: [],
			fixedColumns: [],
			rightFixedColumns: [],
			_data: null,
			filteredData: null,
			data: null,
			sortingColumns: [],
			isAllSelected: false,
			selection: [],
			selectable: null,
			currentRow: null,
			hoverRow: null,
			filters: {},
			expandRows: [],
			aggregates: [],
			defaultExpandAll: false
		};
		VueUtil.merge(this.states, initialState);
	};
	TableStore.prototype.mutations = {
		setData: function(states, data) {
			var table = this.table;
			var dataInstanceChanged = states._data !== data;
			states._data = data;
			states.data = this.sortData((data || []), states);
			var oldCurrentRow = states.currentRow;
			if (states.data.indexOf(oldCurrentRow) === -1) {
				states.currentRow = null;
				if (states.currentRow !== oldCurrentRow) {
					table.$emit('current-change', null, oldCurrentRow);
				}
			}
			if (dataInstanceChanged) {
				this.clearSelection();
			} else {
				var selection = states.selection || [];
				var deleted = selection.filter(function(item) {
					return states.data.indexOf(item) === -1;
				});
				VueUtil.loop(deleted, function(deletedItem) {
					selection.splice(selection.indexOf(deletedItem), 1);
				});
				if (deleted.length) {
					table.$emit('selection-change', selection);
				}
			}
			this.updateAllSelected();
			if (states.defaultExpandAll) {
				states.expandRows = states.data.slice(0);
			}
			VueUtil.isVueComponent(table.$refs.tableBody) && table.$refs.tableBody.resetDelta(data.length);
			Vue.nextTick(function() {
				table.updateScrollY();
				table.resizeZone();
			});
		},
		changeSortCondition: function(states) {
			var self = this;
			states.data = self.sortData((states.filteredData || states._data || []), states);
			self.table.$emit('sort-change', self.states.sortingColumns);
			Vue.nextTick(function() {
				self.table.updateScrollY();
				self.table.resizeZone();
			});
		},
		filterChange: function(states, options) {
			var self = this;
			var values = options.values;
			var column = options.column;
			var silent = options.silent;
			if (values && !VueUtil.isArray(values)) {
				values = [values];
			}
			var prop = column.property;
			if (prop) {
				states.filters[column.id] = values;
			}
			var data = states._data;
			var filters = states.filters;
			VueUtil.ownPropertyLoop(filters, function(columnId) {
				var values = filters[columnId];
				if (!values || values.length === 0) return;
				var column = self.getColumnById(columnId);
				if (column) {
					if (column.filterMethod) {
						data = data.filter(function(row) {
							return values.some(function(value) {
								return column.filterMethod.call(null, value, row)
							});
						});
					} else {
						var columnKey = column.property
						data = data.filter(function(row) {
							return values.some(function(value) {
								return row[columnKey] === value;
							});
						});
					}
				}
			});
			states.filteredData = data;
			states.data = self.sortData(data, states);
			if (!silent) {
				self.table.$emit('filter-change', filters);
			}
			self.table.$refs.tableBody.resetDelta(data.length);
			Vue.nextTick(function() {
				self.table.updateScrollY();
				self.table.resizeZone();
			});
		},
		insertColumn: function(states, column, index) {
			var array = states._columns;
			if (VueUtil.isDef(index)) {
				array.splice(index, 0, column);
			} else {
				array.push(column);
			}
			if (column.type === 'selection') {
				states.selectable = column.selectable;
			}
			this.updateColumns();
		},
		removeColumn: function(states, column) {
			var _columns = states._columns;
			if (_columns.length) {
				_columns.splice(_columns.indexOf(column), 1);
			}
			this.updateColumns();
		},
		setHoverRow: function(states, row) {
			states.hoverRow = row;
		},
		setCurrentRow: function(states, row) {
			var oldCurrentRow = states.currentRow;
			states.currentRow = row;
			if (oldCurrentRow !== row) {
				this.table.$emit('current-change', row, oldCurrentRow);
			}
		},
		rowSelectedChanged: function(states, row) {
			var changed = this.toggleRowSelection(row);
			var selection = states.selection;
			if (changed) {
				var table = this.table;
				table.$emit('selection-change', selection);
				table.$emit('select', selection, row);
			}
			this.updateAllSelected();
		},
		toggleRowExpanded: function(states, row, expanded) {
			var expandRows = states.expandRows;
			if (VueUtil.isDef(expanded)) {
				var index = expandRows.indexOf(row);
				if (expanded) {
					if (index === -1)
						expandRows.push(row);
				} else {
					if (index !== -1)
						expandRows.splice(index, 1);
				}
			} else {
				var index = expandRows.indexOf(row);
				if (index === -1) {
					expandRows.push(row);
				} else {
					expandRows.splice(index, 1);
				}
			}
			var table = this.table;
			Vue.nextTick(function(){
				table.$emit('expand', row, expandRows.indexOf(row) !== -1);
			});
		},
		toggleAllSelection: function(states) {
			var data = states.data || [];
			var value = !states.isAllSelected;
			var selection = this.states.selection;
			var selectionChanged = false;
			var self = this;
			VueUtil.loop(data, function(item, index) {
				if (states.selectable) {
					if (states.selectable.call(null, item, index) && self.toggleRowSelection(item, value)) {
						selectionChanged = true;
					}
				} else {
					if (self.toggleRowSelection(item, value)) {
						selectionChanged = true;
					}
				}
			});
			var table = this.table;
			if (selectionChanged) {
				table.$emit('selection-change', selection);
			}
			table.$emit('select-all', selection);
			states.isAllSelected = value;
		}
	};
	TableStore.prototype.getAggregate = function(columns, data) {
		if (data.length === 0) return;
		var labelMap = {
			'sum': Vue.t('vue.table.sumText'),
			'count': Vue.t('vue.table.countText'),
			'average': Vue.t('vue.table.averageText'),
			'min': Vue.t('vue.table.minText'),
			'max': Vue.t('vue.table.maxText'),
		};
		var aggregates = this.states.aggregates = [];
		VueUtil.loop(columns, function(column) {
			var aggregate = '';
			var resultMap = {};
			resultMap.max = '';
			resultMap.min = '';
			resultMap.sum = '';
			resultMap.average = '';
			resultMap.label = '';
			resultMap.property = column.property;
			var aggregateType = column.aggregate.toLowerCase();
			var aggregateLabel = labelMap[aggregateType];
			if (VueUtil.isDef(column.aggregateLabel)) aggregateLabel = column.aggregateLabel;
			if (VueUtil.isDef(aggregateLabel)) {
				var max = null;
				var min = null;
				var sum = null;
				var precision = 0;
				var valueCount = 0;
				resultMap.count = data.length;
				VueUtil.loop(data, function(row) {
					var value = Number(row[column.property]);
					if (!isNaN(value)) {
						var decimal = ('' + value).split('.')[1];
						decimal && decimal.length > precision ? precision = decimal.length : null;
						VueUtil.isDef(max) ? value > max ? max = value : null : max = value;
						VueUtil.isDef(min) ? value < min ? min = value : null : min = value;
						VueUtil.isDef(sum) ? sum = sum + value : sum = value;
						valueCount++;
					}
				});
				if (valueCount > 0) {
					resultMap.max = max;
					resultMap.min = min;
					resultMap.sum = parseFloat(sum.toFixed(precision));
					resultMap.average = parseFloat((sum / valueCount).toFixed(precision));
				}
				var columnAggregate = resultMap[aggregateType] || '';
				if (!columnAggregate) {
					aggregate = aggregateLabel;
				} else {
					aggregateLabel ? aggregate = aggregateLabel + ': ' + columnAggregate : aggregate = columnAggregate;
				}
				resultMap.label = aggregate;
			}
			aggregates.push(resultMap);
		});
	}
	TableStore.prototype.updateLabelColumns = function() {
		var states = this.states;
		var labelColumns = [];
		var colColumns = [];
		var tableColumns = states._columns;
		var i = tableColumns.length;
		while (i--) {
			var column = tableColumns[i];
			if (column.labelColspan) {
				colColumns.push(column);
			} else {
				if (colColumns.length > 0) {
					colColumns.reverse();
					column.colColumns = [].concat(colColumns);
					colColumns = [];
				}
				labelColumns.push(column);
			}
		}
		labelColumns.reverse();
		states.labelColumns = labelColumns;
	}
	TableStore.prototype.updateColumns = function() {
		var states = this.states;
		var columns = [];
		states.fixedColumns = [];
		states.rightFixedColumns = [];
		VueUtil.loop((states._columns || []).slice(0), function(column) {
			if (column.visible) {
				columns.push(column);
				if (column.fixed === true || column.fixed === 'left') {
					if (column.type === 'selection') {
						column.fixed = false;
					} else {
						states.fixedColumns.push(column);
					}
				}
				if (column.fixed === 'right') {
					if (column.type === 'selection') {
						column.fixed = false;
					} else {
						states.rightFixedColumns.push(column);
					}
				}
			}
		});
		states.fixedColumns.sort(function(a, b) {
			return a.fixedIndex > b.fixedIndex;
		});
		states.rightFixedColumns.sort(function(a, b) {
			return a.fixedIndex < b.fixedIndex;
		});
		if (states.fixedColumns.length > 0 && columns[0] && columns[0].type === 'selection' && !columns[0].fixed) {
			columns[0].fixed = true;
			states.fixedColumns.unshift(columns[0]);
		}
		states.columns = [].concat(states.fixedColumns).concat(columns.filter(function(column) {
			return !column.fixed
		})).concat(states.rightFixedColumns);
		this.updateLabelColumns();
	}
	TableStore.prototype.rowspanData = function(data) {
		var columns = this.states.columns;
		VueUtil.loop(columns, function(column) {
			if (column.rowspan) {
				var val1 = null;
				var val2 = null;
				var startIndex = null;
				column.rowspanAry = [];
				column.rowspanStartAry = []
				VueUtil.loop(data, function(row, index) {
					val1 = row[column.property];
					if (val1 === val2) {
						column.rowspanAry.push(index);
					}
					val2 = val1;
				});
				var spanItem = null;
				VueUtil.loop(column.rowspanAry, function(rowspan, index) {
					var startSpan = rowspan - 1;
					if (column.rowspanAry.indexOf(startSpan) === -1) {
						spanItem = {};
						spanItem.start = startSpan;
						spanItem.spanNum = 2;
						column.rowspanStartAry.push(spanItem)
					} else {
						spanItem.spanNum++;
					}
				});
			}
		});
	}
	TableStore.prototype.sortData = function(data, states) {
		var sortingColumns = states.sortingColumns;
		if (sortingColumns.length !== 0) {
			var orderBy = function(data, sortList) {
				return data.slice(0).sort(function(data1, data2) {
					var index = 0;
					var column = sortList[index];
					index++;
					var sortBy = function() {
						var value1 = data1[column.property];
						var value2 = data2[column.property];
						var sortOrder = 1;
						if (column.order === "descending") {
							sortOrder = -1
						}
						if (value1 === value2) {
							if (index === sortList.length) return;
							column = sortList[index];
							index++;
							return sortBy();
						}
						if (VueUtil.isFunction(column.sortMethod)) {
							return sortMethod(value1, value2) ? sortOrder : -sortOrder;
						} else {
							return value1 > value2 ? sortOrder : -sortOrder;
						}
					};
					return sortBy();
				});
			};
			data = orderBy(data, sortingColumns);
		}
		return data;
	}
	TableStore.prototype.getColumnById = function(columnId) {
		var column = null;
		var columns = this.states.columns;
		var i = columns.length;
		while (i--) {
			var item = columns[i];
			if (item.id === columnId) {
				column = item;
				break;
			}
		}
		return column;
	}
	TableStore.prototype.isSelected = function(row) {
		return (this.states.selection || []).indexOf(row) !== -1;
	}
	TableStore.prototype.clearSelection = function() {
		var states = this.states;
		states.isAllSelected = false;
		var oldSelection = states.selection;
		states.selection = [];
		if (oldSelection.length > 0) {
			this.table.$emit('selection-change', states.selection);
		}
	}
	TableStore.prototype.toggleRowSelection = function(row, selected) {
		var changed = false;
		var selection = this.states.selection;
		var index = selection.indexOf(row);
		if (!VueUtil.isDef(selected)) {
			if (index === -1) {
				selection.push(row);
				changed = true;
			} else {
				selection.splice(index, 1);
				changed = true;
			}
		} else {
			if (selected && index === -1) {
				selection.push(row);
				changed = true;
			} else if (!selected && index !== -1) {
				selection.splice(index, 1);
				changed = true;
			}
		}
		return changed;
	}
	TableStore.prototype.updateAllSelected = function() {
		var states = this.states;
		var selection = states.selection;
		var selectable = states.selectable;
		var data = states.data;
		if (!data || data.length === 0) {
			states.isAllSelected = false;
			return;
		}
		var selectedMap;
		var isSelected = function(row) {
			return selection.indexOf(row) !== -1;
		};
		var isAllSelected = true;
		var selectedCount = 0;
		var i = data.length;
		while (i--) {
			var item = data[i];
			if (selectable) {
				var isRowSelectable = selectable.call(null, item, i);
				if (isRowSelectable) {
					if (!isSelected(item)) {
						isAllSelected = false;
						break;
					} else {
						selectedCount++;
					}
				}
			} else {
				if (!isSelected(item)) {
					isAllSelected = false;
					break;
				} else {
					selectedCount++;
				}
			}
		}
		if (selectedCount === 0) isAllSelected = false;
		states.isAllSelected = isAllSelected;
	}
	TableStore.prototype.commit = function(name) {
		var mutations = this.mutations;
		var args = [];
		VueUtil.loop(arguments, function(arg, index) {
			if (index === 0) return;
			args.push(arg);
		});
		if (mutations[name]) {
			mutations[name].apply(this, [this.states].concat(args));
		} else {
			throw 'Action not found: ' + name;
		}
	}
	var TableLayout = function(options) {
		this.table = null;
		this.store = null;
		this.fit = true;
		this.showHeader = true;
		this.height = null;
		this.scrollX = false;
		this.scrollY = false;
		this.bodyWidth = null;
		this.fixedWidth = null;
		this.rightFixedWidth = null;
		this.headerHeight = 44;
		this.viewportHeight = null;
		this.bodyHeight = null;
		this.fixedBodyHeight = null;
		this.gutterWidth = VueUtil.scrollBarWidth();
		VueUtil.merge(this, options);
	};
	TableLayout.prototype.updateScrollY = function() {
		if (!VueUtil.isNumber(this.height)) return;
		var tbody = this.table.$refs.tableBody.$refs.tbody;
		VueUtil.isElement(tbody) && (this.scrollY = tbody.offsetHeight > this.table.$refs.bodyWrapper.offsetHeight);
	}
	TableLayout.prototype.setHeight = function(value) {
		var prop = 'height';
		var el = this.table.$el;
		if (!el) return;
		if (VueUtil.isString(value) && /^\d+$/.test(value)) {
			value = Number(value);
		}
		this.height = value;
		if (VueUtil.isNumber(value)) {
			el.style[prop] = value + 'px';
		} else if (VueUtil.isString(value)) {
			if (value === '') {
				el.style[prop] = '';
			}
		}
		this.updateHeight();
	}
	TableLayout.prototype.updateHeight = function() {
		var height = this.table.$el ? this.table.$el.clientHeight : 0;
		if (!this.showHeader) {
			this.headerHeight = 0;
			if (VueUtil.isNumber(this.height)) {
				this.bodyHeight = height;
			}
			this.fixedBodyHeight = this.scrollX ? height - this.gutterWidth : height;
		} else {
			var headerWrapper = this.table.$refs.headerWrapper;
			var headerHeight = this.headerHeight = headerWrapper.offsetHeight;
			var footerHeight = 0;
			var footerWrapper = this.table.$refs.footerWrapper;
			if (this.table.showFooter && footerWrapper) {
				footerHeight = footerWrapper.offsetHeight - 1;
			}
			var hfHeight = headerHeight + footerHeight;
			var bodyHeight = height - hfHeight;
			if (VueUtil.isNumber(this.height)) {
				this.bodyHeight = bodyHeight;
			}
			this.fixedBodyHeight = this.scrollX ? bodyHeight - this.gutterWidth : bodyHeight;
		}
		this.viewportHeight = this.scrollX ? height - this.gutterWidth : height;
		if (this.table.showFooter) this.viewportHeight = height;
	}
	TableLayout.prototype.update = function() {
		var fit = this.fit;
		var columns = this.store.states.columns;
		var bodyWidth = this.table.$el ? this.table.$el.clientWidth : 0;
		var bodyMinWidth = 0;
		var flexColumns = [];
		var allColumnsWidth = 0;
		VueUtil.loop(columns, function(column) {
			if (!VueUtil.isNumber(column.width)) {
				flexColumns.push(column);
				allColumnsWidth = allColumnsWidth + (column.minWidth || 80);
			}
			bodyMinWidth += column.width || column.minWidth || 80;
		});
		this.scrollX = bodyMinWidth > bodyWidth;
		this.bodyWidth = bodyMinWidth;
		var flexColumnLen = flexColumns.length;
		if (flexColumnLen > 0 && fit) {
			if (bodyMinWidth <= bodyWidth - this.gutterWidth) {
				this.scrollX = false;
				var totalFlexWidth = bodyWidth - this.gutterWidth - bodyMinWidth;
				var noneFirstWidth = 0;
				var flexWidthPerPixel = totalFlexWidth / allColumnsWidth;
				while (flexColumnLen--) {
					if (flexColumnLen === 0) break;
					var column = flexColumns[flexColumnLen];
					var flexWidth = Math.floor((column.minWidth || 80) * flexWidthPerPixel);
					noneFirstWidth += flexWidth;
					column.realWidth = (column.minWidth || 80) + flexWidth;
				}
				flexColumns[0].realWidth = (flexColumns[0].minWidth || 80) + totalFlexWidth - noneFirstWidth;
			} else {
				this.scrollX = true;
				VueUtil.loop(flexColumns, function(column) {
					column.realWidth = column.minWidth || 80;
				});
			}
			this.bodyWidth = Math.max(bodyMinWidth, bodyWidth);
		}
		var fixedColumns = this.store.states.fixedColumns;
		var fixedWidth = 0;
		VueUtil.loop(fixedColumns, function(column) {
			fixedWidth += column.realWidth || 80;
		});
		this.fixedWidth = fixedWidth;
		var rightFixedColumns = this.store.states.rightFixedColumns;
		var rightFixedWidth = 0;
		VueUtil.loop(rightFixedColumns, function(column) {
			rightFixedWidth += column.realWidth || 80;
		});
		this.rightFixedWidth = rightFixedWidth;
	}
	var TableBody = {
		props: {
			fixed: String
		},
		render: function(createElement) {
			var self = this;
			if (!VueUtil.isDef(self.$options.delta)) this.createDelta();
			var delta = self.$options.delta;
			var columns = self.store.states.columns;
			var storeData = self.store.states.data;
			if (self.fixed) {
				if (((self.fixed === 'left') && self.store.states.fixedColumns.length > 0)
				|| (self.fixed === 'right' && self.store.states.rightFixedColumns.length > 0)) {
					delta = self.tableBody.$options.delta;
					self.$nextTick(self.doResetCurrentRow);
				} else {
					return null;
				}
			} else {
				self.scrollFilter(storeData, delta);
			}
			if (delta.data.length === 0) return null;
			self.store.rowspanData(delta.data);
			return createElement('table', {
				class: 'vue-table__body',
				attrs: {
					cellspacing: '0',
					cellpadding: '0',
					border: '0'
				},
				style: {
					'margin-top': delta.marginTop + 'px',
					'margin-bottom': delta.marginBottom + 'px'
				}
			}, [createElement('colgroup', null, [self._l(columns, function(column, columnIndex) {
				return createElement('col', {
					key: columnIndex,
					attrs: {
						name: column.id,
						width: column.realWidth || column.width || 80
					}
				}, [])
			}), !self.fixed && (self.layout.scrollX || self.layout.scrollY) && self.layout.gutterWidth ? createElement('col', {
				attrs: {
					name: 'gutter',
					width: 0
				}
			}, []) : '']), createElement('tbody', {ref: 'tbody'}, [self._l(delta.data, function(row, index) {
				var $index = storeData.indexOf(row);
				return [createElement('tr', {
					style: self.rowStyle ? self.getRowStyle(row, $index) : null,
					key: $index,
					on: {
						dblclick: function(e) {
							return self.handleDoubleClick(e, row)
						},
						contextmenu: function(e) {
							return self.handleContextMenu(e, row)
						},
						mouseenter: function(e) {
							return self.handleMouseEnter(row)
						},
						mouseleave: function(e) {
							return self.handleMouseLeave()
						}
					},
					class: ['vue-table__row', self.getRowClass(row, $index)]
				}, [self._l(columns, function(column, cellIndex) {
					if (column.rowspan && column.rowspanAry.indexOf(index) !== -1) {
						return null;
					} else {
						var rowspanNum = null;
						if (column.rowspan) {
							VueUtil.loop(column.rowspanStartAry, function(rowspan) {
								if (rowspan.start === index) {
									rowspanNum = rowspan.spanNum;
								}
							});
						}
						return createElement('td', {
							key: cellIndex,
							attrs: {
								rowspan: rowspanNum
							},
							class: ['vue-table__cell', $index % 2 === 1 ? 'grey' : '', column.align, column.getCellClass($index, cellIndex, row) || '', self.$parent.isCellHidden(cellIndex, self.fixed) ? 'is-hidden' : ''],
							on: {
								click: function(e) {
									return self.handleClick(e, row, column)
								},
								mouseenter: function(e) {
									return self.handleCellMouseEnter(e, row, column)
								},
								mouseleave: self.handleCellMouseLeave
							}
						}, [column.renderCell.call(self._renderProxy, createElement, {
							row: row,
							column: column,
							$index: $index,
							store: self.store,
							_self: self.$parent.$vnode.context
						})])
					}
				}), !self.fixed && (self.layout.scrollX || self.layout.scrollY) && self.layout.gutterWidth ? createElement('td', {
					class: 'vue-table__cell gutter'
				}, []) : '']), self.store.states.expandRows.indexOf(row) !== -1 ? createElement('tr', {class: ['vue-table__row', 'vue-table__expanded-row']}, [createElement('td', {
					attrs: {
						colspan: columns.length
					},
					class: ['vue-table__cell', 'vue-table__expanded-cell', self.getExpandClass(row, $index)]
				}, [self.$parent.renderExpanded ? self.$parent.renderExpanded(createElement, {
					row: row,
					$index: $index,
					store: self.store
				}) : ''])]) : null]
			}).concat(self._self.$parent.$slots.append).concat(createElement('vue-tooltip', {
				attrs: {
					effect: self.$parent.tooltipEffect,
					placement: "top",
					content: self.tooltipContent
				},
				ref: "tooltip"
			}, []))])]);
		},
		watch: {
			'store.states.hoverRow': function(newVal) {
				this.doResetHoverRow(newVal);
			},
			'store.states.currentRow': function(newVal) {
				this.doResetCurrentRow(newVal);
			}
		},
		computed: {
			store: function() {
				return this.$parent.store;
			},
			layout: function() {
				return this.$parent.layout;
			},
			rowClassName: function() {
				return this.$parent.rowClassName;
			},
			rowStyle: function() {
				return this.$parent.rowStyle;
			},
			expandClassName: function() {
				return this.$parent.expandClassName;
			},
			highlightCurrent: function() {
				return this.$parent.highlightCurrentRow;
			},
			highlightHover: function() {
				return this.$parent.highlightHoverRow;
			},
			tableBody: function() {
				return this.$parent.$refs.tableBody;
			},
			fixedTableBody: function() {
				return this.$parent.$refs.fixedTableBody;
			},
			rightFixedTableBody: function() {
				return this.$parent.$refs.rightFixedTableBody;
			}
		},
		data: function() {
			return {
				tooltipContent: '',
				currentRow: null,
				hoverRow: null
			};
		},
		methods: {
			createDelta: function() {
				if (this.fixed) return;
				var delta = this.$options.delta = {};
				delta.start = 0;
				delta.end = 0;
				delta.total = 0;
				delta.keeps = 0;
				delta.marginTop = 0;
				delta.marginBottom = 0;
				delta.size = 0;
				delta.remain = 0;
				delta.data = [];
				var table = this.$parent;
				if (table.height && table.lazyload) {
					delta.remain = Math.floor(table.height * 1 / delta.size) + 10;
					delta.end = delta.remain;
					delta.keeps = delta.remain;
				}
			},
			resetDelta: function(dataLen) {
				if (this.fixed) return;
				var delta = this.$options.delta;
				if (delta.keeps === 0) return;
				delta.start = 0;
				if (dataLen <= delta.remain) {
					delta.end = dataLen;
					delta.keeps = dataLen;
				} else {
					delta.end = delta.remain;
					delta.keeps = delta.remain;
				}
			},
			scrollFilter: function(slots, delta) {
				delta.data = [];
				if (delta.keeps === 0 || slots.length <= delta.keeps) {
					delta.marginTop = 0;
					delta.marginBottom = 0;
					delta.data = slots;
				} else {
					delta.total = slots.length;
					delta.marginTop = delta.size * delta.start;
					delta.marginBottom = delta.size * (delta.total - delta.keeps - delta.start);
					for (var i = delta.start, j = delta.end; i < j; i++) {
						delta.data.push(slots[i]);
					}
				}
			},
			updateZone: function(offset) {
				if (this.fixed) return;
				var delta = this.$options.delta;
				if (delta.keeps === 0) return;
				delta.size = 40;
				if (VueUtil.isElement(this.$refs.tbody)) delta.size = this.$refs.tbody.firstElementChild.offsetHeight;
				delta.remain = Math.floor(this.$parent.height * 1 / delta.size) + 11;
				delta.keeps = delta.remain;
				if (delta.total <= delta.keeps) return;
				var overs = Math.floor(offset / delta.size) - 6;
				overs < 0 && (overs = 0);
				var start = overs ? overs : 0;
				var end = overs ? (overs + delta.keeps) : delta.keeps;
				if (overs + delta.keeps >= delta.total) {
					end = delta.total;
					start = delta.total - delta.keeps;
				}
				delta.end = end;
				delta.start = start;
				this.forceUpdate();
				this.$nextTick(this.doResetCurrentRow);
			},
			forceUpdate: VueUtil.throttle(function() {
				this.tableBody.$forceUpdate();
				this.fixedTableBody.$forceUpdate();
				this.rightFixedTableBody.$forceUpdate();
			}),
			doResetCurrentRow: VueUtil.throttle(function(currentRow) {
				this.tableBody.resetCurrentRow(currentRow);
				this.fixedTableBody.resetCurrentRow(currentRow);
				this.rightFixedTableBody.resetCurrentRow(currentRow);
			}),
			doResetHoverRow: VueUtil.throttle(function(hoverRow) {
				this.tableBody.resetHoverRow(hoverRow);
				this.fixedTableBody.resetHoverRow(hoverRow);
				this.rightFixedTableBody.resetHoverRow(hoverRow);
			}),
			resetCurrentRow: function(currentRowObj) {
				if (!this.highlightCurrent || !VueUtil.isElement(this.$refs.tbody)) return;
				var tbody = this.$refs.tbody;
				var oldCurrentRow = this.currentRow;
				oldCurrentRow && oldCurrentRow.classList.remove('current-row');
				if (!VueUtil.isDef(currentRowObj)) currentRowObj = this.store.states.currentRow;
				var data = this.tableBody.$options.delta.data;
				var rows = tbody.querySelectorAll('.vue-table__row:not(.vue-table__expanded-row)');
				var currentRow = rows[data.indexOf(currentRowObj)];
				currentRow && currentRow.classList.add('current-row');
				this.currentRow = currentRow;
			},
			resetHoverRow: function(hoverRowObj) {
				if (!this.highlightHover ||!VueUtil.isElement(this.$refs.tbody)) return;
				var tbody = this.$refs.tbody;
				var oldHoverRow = this.hoverRow;
				oldHoverRow && oldHoverRow.classList.remove('hover-row');
				if (!VueUtil.isDef(hoverRowObj)) return;
				var data = this.tableBody.$options.delta.data;
				var rows = tbody.querySelectorAll('.vue-table__row:not(.vue-table__expanded-row)');
				var hoverRow = rows[data.indexOf(hoverRowObj)];
				hoverRow && hoverRow.classList.add('hover-row');
				this.hoverRow = hoverRow;
			},
			getCell: function(event) {
				var cell = event.target;
				while (cell && cell.tagName.toUpperCase() !== 'HTML') {
					if (cell.tagName.toUpperCase() === 'TD') {
						return cell;
					}
					cell = cell.parentNode;
				}
				return null;
			},
			getRowStyle: function(row, index) {
				var rowStyle = this.rowStyle;
				if (VueUtil.isFunction(rowStyle)) {
					return rowStyle.call(null, row, index);
				}
				return rowStyle;
			},
			getRowClass: function(row, index) {
				var classes = [];
				var rowClassName = this.rowClassName;
				if (VueUtil.isString(rowClassName)) {
					classes.push(rowClassName);
				} else if (VueUtil.isFunction(rowClassName)) {
					classes.push(rowClassName.call(null, row, index) || '');
				}
				return classes.join(' ');
			},
			getExpandClass: function(row, index) {
				var classes = [];
				var expandClassName = this.expandClassName;
				if (VueUtil.isString(expandClassName)) {
					classes.push(expandClassName);
				} else if (VueUtil.isFunction(expandClassName)) {
					classes.push(expandClassName.call(null, row, index) || '');
				}
				return classes.join(' ');
			},
			handleCellMouseEnter: function(event, row, column) {
				var table = this.$parent;
				var cell = this.getCell(event);
				if (cell) {
					var hoverState = table.hoverState = {cell: cell, column: column, row: row};
					table.$emit('cell-mouse-enter', hoverState.row, hoverState.column, hoverState.cell, event);
				}
				var cellChild = event.target.querySelector('.cell');
				if (VueUtil.hasClass(cellChild, 'vue-tooltip') && cellChild.scrollWidth > cellChild.offsetWidth) {
					var tooltip = this.$refs.tooltip;
					var activateTooltip = VueUtil.debounce(function(tooltip) {
						return tooltip.handleShowPopper();
					});
					this.tooltipContent = cell.innerText;
					tooltip.referenceElm = cell;
					tooltip.$refs.popper.style.display = 'none';
					tooltip.doDestroy();
					tooltip.setExpectedState(true);
					activateTooltip(tooltip);
				}
			},
			handleCellMouseLeave: function(event) {
				var tooltip = this.$refs.tooltip;
				if (tooltip) {
					tooltip.setExpectedState(false);
					tooltip.handleClosePopper();
				}
				var cell = this.getCell(event);
				if (!cell) return;
				var oldHoverState = this.$parent.hoverState;
				this.$parent.$emit('cell-mouse-leave', oldHoverState.row, oldHoverState.column, oldHoverState.cell, event);
			},
			handleMouseEnter: function(row) {
				this.store.commit('setHoverRow', row);
			},
			handleMouseLeave: function() {
				this.store.commit('setHoverRow', null);
			},
			handleContextMenu: function(event, row) {
				this.$parent.$emit('row-contextmenu', row, event);
			},
			handleDoubleClick: function(event, row) {
				this.$parent.$emit('row-dblclick', row, event);
			},
			handleClick: function(event, row, column) {
				var table = this.$parent;
				var cell = this.getCell(event);
				if (cell) {
					table.$emit('cell-click', row, column, cell, event);
				}
				this.store.commit('setCurrentRow', row);
				table.$emit('row-click', row, event, column);
			},
			handleExpandClick: function(row) {
				this.store.commit('toggleRowExpanded', row);
			}
		}
	};
	var VueTableFilterPanel = {
			template: '<transition @after-leave="doDestroy"><div class="vue-table-filter" v-show="showPopper" v-clickoutside="handleOutsideClick"><div class="vue-table-filter__content"><vue-checkbox-group v-model="filteredValue"><vue-list :height="150" ref="list" class="vue-table-filter__list"><vue-list-item  v-for="(filter, index) in filters" :key="index" class="vue-table-filter__list-item"><vue-checkbox :label="filter">{{filter}}</vue-checkbox></vue-list-item></vue-list></vue-checkbox-group></div><div class="vue-table-filter__bottom"><vue-button @click="handleConfirm" type="text" :disabled="filteredValue.length === 0">{{$t(\'vue.table.confirmFilter\')}}</vue-button><vue-button type="text" @click="handleReset">{{$t(\'vue.table.resetFilter\')}}</vue-button></div></div></transition>',
			name: 'VueTableFilterPanel',
			mixins: [VuePopper],
			directives: {
				Clickoutside: VueUtil.component.clickoutside()
			},
			props: {
				placement: {
					type: String,
					default: 'bottom'
				}
			},
			methods: {
				handleOutsideClick: function() {
					this.showPopper = false;
				},
				handleConfirm: function() {
					this.confirmFilter(this.filteredValue);
					this.handleOutsideClick();
				},
				handleReset: function() {
					this.filteredValue = [];
					this.handleConfirm();
				},
				confirmFilter: function(filteredValue) {
					this.column.filtered = false;
					if (filteredValue.length > 0) {
						this.column.filtered = true;
					}
					this.table.store.commit('filterChange', {
						column: this.column,
						values: filteredValue
					});
				}
			},
			data: function() {
				return {
					table: null,
					cell: null,
					column: null,
					dropdown: {
						dropdowns: [],
						open: function(instance) {
							if (instance) {
								this.dropdowns.push(instance);
							}
						},
						close: function(instance) {
							var index = this.dropdowns.indexOf(instance);
							if (index !== -1) {
								this.dropdowns.splice(instance, 1);
							}
						}
					}
				};
			},
			computed: {
				filters: function() {
					var filterList = [];
					var column = this.column;
					VueUtil.loop(this.table.store.states._data, function(row) {
						var columnData = row[column.property];
						if (filterList.indexOf(columnData) === -1) {
							filterList.push(columnData);
						}
					});
					return filterList
				},
				filteredValue: {
					get: function() {
						if (this.column) {
							return this.column.filteredValue || [];
						}
						return [];
					},
					set: function(value) {
						if (this.column) {
							this.column.filteredValue = value;
						}
					}
				}
			},
			mounted: function() {
				var self = this;
				self.popperElm = self.$el;
				self.referenceElm = self.cell;
				self.$watch('showPopper', function(value) {
					if (self.column)
						self.column.filterOpened = value;
					if (value) {
						self.dropdown.open(self);
						self.$nextTick(self.$refs.list.updateZone)
					} else {
						self.dropdown.close(self);
					}
				});
			}
		};
	var TableHeader = {
		render: function(createElement) {
			if (!this.$parent.showHeader
				|| ((this.fixed === 'left') && this.store.states.fixedColumns.length === 0)
				|| (this.fixed === 'right' && this.store.states.rightFixedColumns.length === 0)) return null;
			var self = this;
			var columns = self.store.states.columns;
			var columnRows = self.convertToRows(columns);
			return createElement('table', {
				class: 'vue-table__header',
				attrs: {
					cellspacing: '0',
					cellpadding: '0',
					border: '0'
				}
			}, [createElement('colgroup', null, [self._l(columns, function(column, columnIndex) {
				return createElement('col', {
					key: columnIndex,
					attrs: {
						name: column.id,
						width: column.realWidth || column.width || 80
					}
				}, [])
			}), !self.fixed && (self.layout.scrollX || self.layout.scrollY) && self.layout.gutterWidth ? createElement('col', {
				attrs: {
					name: 'gutter',
					width: self.layout.gutterWidth
				}
			}, []) : '']), createElement('thead', null, [self._l(columnRows, function(columns, rowIndex) {
				return createElement('tr', {class: ['vue-table__row'], key:rowIndex}, [self._l(columns, function(column, cellIndex) {
					return column.labelColspan ? null : createElement('th', {
						key: cellIndex,
						attrs: {
							colspan: column.labelColspanNum
						},
						on: {
							mousemove: function(e) {
								return self.handleMouseMove(e, column)
							},
							mouseout: self.handleMouseOut,
							mousedown: function(e) {
								return self.handleMouseDown(e, column)
							},
							touchstart: function(e) {
								return self.handleMouseDown(e, column)
							},
							click: function(e) {
								return self.handleHeaderClick(e, column)
							}
						},
						class: ['vue-table__column', column.order, column.headerAlign, rowIndex === 0 && self.$parent.isCellHidden(cellIndex, self.fixed) ? 'is-hidden' : '', 'is-leaf', column.labelClassName]
					}, [createElement('div', {
						class: ['cell', column.filtered || column.order ? 'highlight' : ''],
						style: {'width': column.renderHeader ? '100%' : '', 'padding': column.renderHeader ? 0 : ''},
					}, [column.renderHeader ? column.renderHeader.call(self._renderProxy, createElement) : column.label,
						column.sortable && !column.renderHeader ? createElement('span', {
						class: 'vue-table__sort-wrapper',
						on: {
							click: function(e) {
								return self.handleSortClick(e, column);
							}
						}
					}, [createElement('i', {
						class: ['is-sort', column.order === 'descending' ? 'vue-icon-sort-desc' : 'vue-icon-sort-asc'],
					}, [])]) : '', column.filterable && !column.renderHeader ? createElement('span', {
						class: 'vue-table__column-filter-trigger',
						on: {
							click: function(e) {
								return self.handleFilterClick(e, column)
							}
						}
					}, [createElement('i', {
						class: ['vue-icon-filter', column.filtered ? 'is-filtered' : '']
					}, [])]) : ''])])
				}), !self.fixed && (self.layout.scrollX || self.layout.scrollY) && self.layout.gutterWidth ? createElement('th', {
					class: 'vue-table__column gutter'
				}, []) : ''])
			})])]);
		},
		props: {
			fixed: String
		},
		computed: {
			store: function() {
				return this.$parent.store;
			},
			layout: function() {
				return this.$parent.layout;
			},
			border: function() {
				return this.$parent.border;
			},
			defaultSort: function() {
				return this.$parent.defaultSort;
			}
		},
		created: function() {
			this.filterPanels = {};
		},
		mounted: function() {
			this.setDefaultSortColumn();
		},
		beforeDestroy: function() {
			var panels = this.filterPanels;
			VueUtil.ownPropertyLoop(panels, function(prop) {
				if (VueUtil.isDef(panels[prop])) {
					panels[prop].$destroy(true);
				}
			});
		},
		methods: {
			setDefaultSortColumn: function() {
				if (this.fixed) return;
				var self = this;
				var sortingColumns = self.store.states.sortingColumns;
				VueUtil.loop(self.defaultSort, function(sort) {
					VueUtil.loop(self.store.states.columns, function(column) {
						if (column.property === sort.prop) {
							column.order = sort.order;
							sortingColumns.push(column);
						}
					});
				});
			},
			convertToRows: function(columns) {
				var rows = [[]];
				var colspan = 1;
				var i = columns.length;
				while (i--) {
					var column = columns[i];
					column.labelColspanNum = 1
					if (!column.labelColspan) {
						column.labelColspanNum = colspan;
						colspan = 1;
					} else {
						colspan++;
					}
					rows[0].push(column);
				}
				rows[0].reverse();
				return rows;
			},
			toggleAllSelection: function() {
				this.store.commit('toggleAllSelection');
			},
			handleFilterClick: function(event, column) {
				event.stopPropagation();
				var target = event.target;
				var cell = target.parentNode;
				var filterPanel = this.filterPanels[column.id];
				if (filterPanel && column.filterOpened) {
					filterPanel.showPopper = false;
					return;
				}
				if (!filterPanel) {
					filterPanel = new Vue(VueTableFilterPanel);
					this.filterPanels[column.id] = filterPanel;
					filterPanel.table = this.$parent;
					filterPanel.cell = cell;
					filterPanel.column = column;
					filterPanel.$mount(document.createElement('div'));
				}
				this.$nextTick(function() {
					filterPanel.showPopper = true;
				});
			},
			handleHeaderClick: function(event, column) {
				this.$parent.$emit('header-click', column, event);
			},
			handleMouseDown: function(event, column) {
				var self = this;
				if (event.touches) {
					self.handleMouseMove(event, column);
				}
				if (self.draggingColumn && self.border) {
					self.dragging = true;
					self.$parent.resizeProxyVisible = true;
					var tableEl = self.$parent.$el;
					var tableLeft = tableEl.getBoundingClientRect().left;
					var columnEl = event.currentTarget;
					var columnRect = columnEl.getBoundingClientRect();
					var minLeft = columnRect.left - tableLeft + 30;
					columnEl.classList.add('noclick');
					self.dragState = {
						startMouseLeft: event.clientX || event.touches[0].clientX,
						startLeft: columnRect.right - tableLeft,
						startColumnLeft: columnRect.left - tableLeft,
						tableLeft: tableLeft
					};
					var resizeProxy = self.$parent.$refs.resizeProxy;
					resizeProxy.style.left = self.dragState.startLeft + 'px';
					document.onselectstart = function() {
						return false;
					}
					document.ondragstart = function() {
						return false;
					}
					var handleMouseMove = function(event) {
						var deltaLeft = (event.clientX || event.touches[0].clientX) - self.dragState.startMouseLeft;
						var proxyLeft = self.dragState.startLeft + deltaLeft;
						resizeProxy.style.left = Math.max(minLeft, proxyLeft) + 'px';
					};
					var handleMouseUp = function() {
						if (self.dragging) {
							var finalLeft = parseInt(resizeProxy.style.left, 10);
							var startLeft = self.dragState.startLeft;
							var startColumnLeft = self.dragState.startColumnLeft;
							var draggingColumnNum = 1;
							if (VueUtil.isArray(column.colColumns)) {
								draggingColumnNum = draggingColumnNum + column.colColumns.length;
							}
							var columnWidth = parseInt((finalLeft - startColumnLeft) / draggingColumnNum);
							column.width = column.realWidth = columnWidth;
							VueUtil.loop(column.colColumns, function(colColumn){
								colColumn.width = colColumn.realWidth = columnWidth;
							});
							self.$parent.$emit('header-dragend', finalLeft - startColumnLeft, startLeft - startColumnLeft, column, event);
							document.body.style.cursor = '';
							self.dragging = false;
							self.draggingColumn = null;
							self.dragState = {};
							self.$parent.resizeProxyVisible = false;
							self.$parent.doLayout();
						}
						VueUtil.removeTouchMove(document, handleMouseMove);
						VueUtil.removeTouchEnd(document, handleMouseUp);
						document.onselectstart = null;
						document.ondragstart = null;
						self.$nextTick(function() {
							columnEl.classList.remove('noclick');
						});
					};
					VueUtil.addTouchMove(document, handleMouseMove);
					VueUtil.addTouchEnd(document, handleMouseUp);
				}
			},
			handleMouseMove: function(event, column) {
				var target = event.target;
				while (target && !VueUtil.hasClass(target, 'vue-table__column')) {
					target = target.parentNode;
				}
				if (!column || !column.resizable) return;
				if (!this.dragging && this.border) {
					var rect = target.getBoundingClientRect();
					var bodyStyle = document.body.style;
					if (rect.width > 12 && rect.right - (event.pageX || event.touches[0].pageX) < 8) {
						bodyStyle.cursor = 'col-resize';
						this.draggingColumn = column;
					} else if (!this.dragging) {
						bodyStyle.cursor = '';
						this.draggingColumn = null;
					}
				}
			},
			handleMouseOut: function() {
				document.body.style.cursor = '';
			},
			toggleOrder: function(order) {
				return !order ? 'ascending' : order === 'ascending' ? 'descending' : null;
			},
			handleSortClick: function(event, column) {
				event.stopPropagation();
				var target = event.target;
				while (target && !VueUtil.hasClass(target, 'vue-table__column')) {
					target = target.parentNode;
				}
				if (target && VueUtil.hasClass(target, 'vue-table__column')) {
					if (target.classList.contains('noclick')) {
						target.classList.remove('noclick');
						return;
					}
				}
				var states = this.store.states;
				var sortingColumns = states.sortingColumns;
				column.order = this.toggleOrder(column.order);
				var sortIndex = sortingColumns.indexOf(column);
				if (sortIndex === -1) {
					sortingColumns.push(column);
				} else if (column.order === null) {
					sortingColumns.splice(sortIndex, 1);
				}
				this.store.commit('changeSortCondition');
			}
		},
		data: function() {
			return {
				draggingColumn: null,
				dragging: false,
				dragState: {}
			};
		}
	};
	var TableFooter = {
		render: function(createElement) {
			if (!this.$parent.showFooter
				|| ((this.fixed === 'left') && this.store.states.fixedColumns.length === 0)
				|| (this.fixed === 'right' && this.store.states.rightFixedColumns.length === 0)) return null;
			var self = this;
			var aggregates = self.fixed ? self.$parent.$refs.tableFooter.aggregates : self.aggregates;
			var columns = self.store.states.columns;
			return createElement('table', {
				class: 'vue-table__footer',
				attrs: {
					cellspacing: '0',
					cellpadding: '0',
					border: '0'
				}
			}, [createElement('colgroup', null, [self._l(columns, function(column, columnIndex) {
				return createElement('col', {
					key: columnIndex,
					attrs: {
						name: column.id,
						width: column.realWidth || column.width || 80
					}
				}, []);
			}), !self.fixed && (self.layout.scrollX || self.layout.scrollY) && self.layout.gutterWidth ? createElement('col', {
				attrs: {
					name: 'gutter',
					width: self.layout.gutterWidth
				}
			}, []) : '']), createElement('tfoot', null, [createElement('tr', {class: ['vue-table__row']}, [self._l(columns, function(column, cellIndex) {
				return createElement('th', {
					key: cellIndex,
					attrs: {
						colspan: column.colSpan,
						rowspan: column.rowSpan
					},
					class: ['vue-table__column', column.align, column.className || '', self.$parent.isCellHidden(cellIndex, self.fixed) ? 'is-hidden' : '', 'is-leaf', column.labelClassName]
				}, [createElement('div', {
					class: ['cell', column.labelClassName]
				}, [aggregates[cellIndex] ? aggregates[cellIndex].label : ''])])
			}), !self.fixed && (self.layout.scrollX || self.layout.scrollY) && self.layout.gutterWidth ? createElement('th', {
				class: 'vue-table__column gutter'
			}, []) : ''])])]);
		},
		props: {
			fixed: String,
		},
		data: function() {
			return {
				aggregates: []
			}
		},
		computed: {
			store: function() {
				return this.$parent.store;
			},
			layout: function() {
				return this.$parent.layout;
			}
		},
		watch: {
			'$parent.emptyLabel': function() {
				if (this.$parent.showFooter && !this.fixed) {
					this.store.getAggregate(this.store.states.columns, this.store.states.data);
					this.aggregates = this.store.states.aggregates;
				}
			}
		}
	};
	var TableContextMenu = {
		template: '<vue-dialog v-model="dialogVisible" custom-class="vue-table-context-menu" :title="$t(\'vue.table.contextMenu\')" show-close @close="closeHandle"><vue-tabs><vue-tab-pane :label="$t(\'vue.table.pin\')"><vue-form label-width="100px"><vue-form-item :label="$t(\'vue.table.leftPin\')"><vue-select clearable v-model="pinForm.leftPin" multiple @change="leftPin" @remove-tag="noPin"><vue-option v-for="(column, index) in labelColumns" :key="index" :label="column.label" :value="column"></vue-option></vue-select></vue-form-item><vue-form-item :label="$t(\'vue.table.rightPin\')"><vue-select clearable v-model="pinForm.rightPin" multiple @change="rightPin" @remove-tag="noPin"><vue-option v-for="(column, index) in labelColumns" :key="index" :label="column.label" :value="column"></vue-option></vue-select></vue-form-item></vue-form></vue-tab-pane><vue-tab-pane :label="$t(\'vue.table.sort\')"><vue-list :height="150" :default-selected="false"><vue-list-item v-for="(column, index) in labelColumns" :key="index"><vue-button type="text" style="padding-left:15px" @click="removeSortColumn(column, true)">{{column.label}}</vue-button><div style="float:right;"><vue-button style="padding:10px 0 0 0;" :style="{color: column.order === \'ascending\' ? \'#eb9e05\' : \'rgb(151, 168, 190)\'}" icon="vue-icon-caret-top" type="text" @click="sortColumn(column)"></vue-button><vue-button style="padding:10px 15px 0 0;" :style="{color: column.order === \'descending\' ? \'#eb9e05\' : \'rgb(151, 168, 190)\'}" icon="vue-icon-caret-bottom" type="text" @click="sortColumn(column, true)"></vue-button></div><vue-divider v-if="index!==labelColumns.length-1"></vue-divider></vue-list-item></vue-list><vue-form label-width="70px"><vue-form-item :label="$t(\'vue.table.sortBy\')"><vue-tag hit style="margin:5px 5px 0 0;" v-for="(column, index) in sortList" :key="index" closable type="info" @close="removeSortColumn(column)">{{column.label}}<i style="padding:5px 0 0 5px;" :class="[{\'vue-icon-caret-top\': column.order === \'ascending\'}, {\'vue-icon-caret-bottom\': column.order === \'descending\'}]"></i></vue-tag></vue-form-item></vue-form></vue-tab-pane><vue-tab-pane :label="$t(\'vue.table.filter\')"><vue-form label-width="100px" :model="filterForm"><vue-form-item :label="$t(\'vue.table.column\')"><vue-select v-model="filterForm.filterColumn"><vue-option v-for="(column, index) in labelColumns" :key="index" :label="column.label" :value="column"></vue-option></vue-select></vue-form-item><vue-form-item :label="$t(\'vue.table.conditions\')"><vue-input icon="vue-icon-search" v-model="filterForm.conditions" :on-icon-click="filterColumn" @keydown.enter.native="filterColumn" ref="filterInput"><vue-select slot="prepend" v-model="filterForm.operations" style="width:80px;font-size:21px;" @change="operationsChange"><vue-option v-for="(item, index) in operations" :key="index" :label="item" :value="item"></vue-option></vue-select></vue-input></vue-form-item></vue-form><vue-divider></vue-divider><vue-form label-width="100px"><vue-form-item :label="$t(\'vue.table.filterBy\')"><vue-tag hit style="margin:5px 5px 0 0;" v-for="(column, index) in filterList" :key="index" closable type="info" @close="removeFilterColumn(column)">{{column.label}} {{column.operations}} {{column.conditions}}</vue-tag></vue-form-item></vue-form></vue-tab-pane><vue-tab-pane :label="$t(\'vue.table.display\')"><vue-list :height="150" :default-selected="false"><vue-list-item v-for="(column, index) in labelColumns" :key="index" @select="displayColumn(column)" style="cursor:pointer;"><vue-button type="text" style="padding-left:15px">{{column.label}}</vue-button><div style="float:right;"><vue-button style="padding:10px 15px 0 0;" :style="{color: column.visible ? \'#13ce66\' : \'#a94442\'}" :icon="column.visible ? \'vue-icon-success\' : \'vue-icon-error\'" type="text"></vue-button></div><vue-divider v-if="index!==labelColumns.length-1"></vue-divider></vue-list-item></vue-list></vue-tab-pane><vue-tab-pane :label="$t(\'vue.table.exportData\')"><vue-form label-width="100px"><vue-form-item :label="$t(\'vue.table.fileName\')"><vue-input v-model="fileName"></vue-input></vue-form-item></vue-form><div style="text-align:right"><vue-button @click="exportData(true)" plain type="info" icon="vue-icon-download2">{{$t(\'vue.table.exportOrgData\')}}</vue-button><vue-button @click="exportData(false)" type="primary" icon="vue-icon-download2">{{$t(\'vue.table.exportHandleData\')}}</vue-button></div></vue-tab-pane></vue-tabs></vue-dialog>',
		data: function() {
			return {
				tableColumns: [],
				pinForm: {
					leftPin: [],
					rightPin: []
				},
				filterForm: {
					filterColumn: null,
					conditions: null,
					operations: '='
				},
				operations: ['=', '<', '>', '<=', '>=', '<>', '%'],
				sortList: [],
				filterList: [],
				dialogVisible: false,
				fileName: ''
			}
		},
		props: {
			visible: Boolean,
		},
		model: {
			prop: 'visible'
		},
		watch: {
			visible: function(val) {
				this.dialogVisible = val;
			}
		},
		computed: {
			store: function() {
				return this.$parent.store;
			},
			labelColumns: function() {
				return this.$parent.store.states.labelColumns;
			}
		},
		methods: {
			closeHandle: function() {
				this.$parent.showContextMenu = false;
			},
			operationsChange: function() {
				this.$nextTick(this.$refs.filterInput.focus);
			},
			exportData: function(flg) {
				var params = {};
				params.fileName = this.fileName;
				params.original = flg;
				this.$parent.exportCsv(params);
			},
			noPin: function(tag) {
				this.removePin(tag.value);
			},
			removePin: function(column) {
				column.fixed = false;
				this.$parent.doLayout();
			},
			leftPin: function(columns) {
				if (columns.length <= 0) {
					var layoutFLg = false;
					VueUtil.loop(this.tableColumns, function(column) {
						if (column.fixed === true || column.fixed === 'left') {
							column.fixed = false;
							layoutFLg = true;
						}
					});
					if (layoutFLg) this.$parent.doLayout();
					return;
				}
				var self = this;
				VueUtil.loop(columns, function(column, index) {
					var rightIndex = self.pinForm.rightPin.indexOf(column);
					if (rightIndex !== -1) self.pinForm.rightPin.splice(rightIndex, 1);
					column.fixed = 'left';
					column.fixedIndex = index;
					VueUtil.loop(column.colColumns, function(colColumn) {
						colColumn.fixed = 'left';
						colColumn.fixedIndex = index;
					});
				});
				this.$parent.doLayout();
			},
			rightPin: function(columns) {
				if (columns.length <= 0) {
					var layoutFLg = false;
					VueUtil.loop(this.tableColumns, function(column) {
						if (column.fixed === 'right') {
							column.fixed = false;
							layoutFLg = true;
						}
					});
					if (layoutFLg) this.$parent.doLayout();
					return;
				}
				var self = this;
				VueUtil.loop(columns, function(column, index) {
					var leftIndex = self.pinForm.leftPin.indexOf(column);
					if (leftIndex !== -1) self.pinForm.leftPin.splice(leftIndex, 1);
					column.fixed = 'right';
					column.fixedIndex = index;
					VueUtil.loop(column.colColumns, function(colColumn) {
						colColumn.fixed = 'right';
						colColumn.fixedIndex = index;
					});
				});
				this.$parent.doLayout();
			},
			sortColumn: function(column, descFlg) {
				column.sortable = true;
				if (descFlg) {
					column.order = "descending";
				} else {
					column.order = "ascending";
				}
				var sortIndex = this.sortList.indexOf(column);
				if (sortIndex === -1) {
					this.sortList.push(column);
				}
				this.doSort();
			},
			removeSortColumn: function(column, flg) {
				if (flg) column.sortable = false;
				var sortIndex = this.sortList.indexOf(column);
				if (sortIndex === -1) return;
				column.order = "";
				this.sortList.splice(sortIndex, 1);
				this.doSort();
			},
			doSort: function() {
				this.store.commit('changeSortCondition');
			},
			filterColumn: function() {
				var filterColumn = this.filterForm.filterColumn;
				if (!VueUtil.isDef(filterColumn)) return;
				filterColumn.conditions = this.filterForm.conditions;
				filterColumn.operations = this.filterForm.operations;
				if (VueUtil.isFunction(filterColumn.filterMethod) && !VueUtil.isDef(filterColumn.orgFilterMethod)) {
					filterColumn.orgFilterMethod = filterColumn.filterMethod;
				}
				filterColumn.filterMethod = function(value, row) {
					switch (filterColumn.operations) {
						case '=':
							return row[filterColumn.property] === filterColumn.conditions;
						case '>':
							return row[filterColumn.property] > filterColumn.conditions;
						case '<':
							return row[filterColumn.property] < filterColumn.conditions;
						case '<=':
							return row[filterColumn.property] <= filterColumn.conditions;
						case '>=':
							return row[filterColumn.property] >= filterColumn.conditions;
						case '<>':
							return row[filterColumn.property] !== filterColumn.conditions;
						case '%':
							return row[filterColumn.property].indexOf(filterColumn.conditions) !== -1;
					}
				}
				var existflg = false;
				VueUtil.loop(this.filterList, function(filterObj) {
					if (filterColumn.property === filterObj.property) {
						existflg = true;
					}
				});
				if (filterColumn && !existflg) {
					this.filterList.push(filterColumn);
				}
				this.doFilter();
			},
			removeFilterColumn: function(column) {
				var store = this.store;
				store.commit('filterChange', {
					column: column,
					values: []
				});
				if (column.orgFilterMethod) {
					column.filterMethod = column.orgFilterMethod;
					column.orgFilterMethod = null;
				}
				this.filterList.splice(this.filterList.indexOf(column), 1);
			},
			doFilter: function() {
				var store = this.store;
				var filterList = this.filterList;
				VueUtil.loop(filterList, function(filterColumn) {
					store.commit('filterChange', {
						column: filterColumn,
						values: 'filter'
					});
				})
				this.doSort();
				this.$forceUpdate();
			},
			displayColumn: function(column) {
				column.visible = !column.visible;
				VueUtil.loop(column.colColumns, function(colColumn) {
					colColumn.visible = !colColumn.visible;
				});
				this.$parent.doLayout();
			}
		},
		mounted: function() {
			if (this.store) {
				var tableColumns = this.tableColumns;
				VueUtil.loop(this.store.states._columns, function(column) {
					if (column.property !== 'selectionColumn'
						&& column.property !== 'indexColumn'
						&& column.property !== 'expandColumn') {
						tableColumns.push(column)
					}
				});
				this.pinForm.leftPin = this.store.states.fixedColumns;
				this.pinForm.rightPin = this.store.states.rightFixedColumns
				this.sortList = this.store.states.sortingColumns;
			}
		}
	};
	var VueTable = {
		template: '<div :class="[\'vue-table\', {\'vue-table--fit\': fit, \'vue-table--striped\': stripe, \'vue-table--border\': border}]" @mouseleave="handleMouseLeave($event)" :style="{width: layout.bodyWidth <= 0 ? \'0px\' : \'\'}"><div class="hidden-columns" ref="hiddenColumns"><slot></slot></div><div class="vue-table__main"><div class="vue-table__header-wrapper" ref="headerWrapper" v-show="showHeader"><table-header ref="tableHeader" :style="{width: layout.bodyWidth ? layout.bodyWidth + \'px\' : \'\'}"></table-header></div><div class="vue-table__body-wrapper" ref="bodyWrapper" :style="[bodyHeight]"><table-body ref="tableBody" :style="{width: bodyWidth}"></table-body><div :style="{width: bodyWidth}" class="vue-table__empty-block" v-show="!data || data.length === 0"><span class="vue-table__empty-text"><slot name="empty">{{emptyText || emptyLabel}}</slot></span></div></div><div class="vue-table__footer-wrapper" ref="footerWrapper" v-show="showFooter"><table-footer ref="tableFooter" :style="{width: layout.bodyWidth ? layout.bodyWidth + \'px\' : \'\'}"></table-footer></div></div><div class="vue-table__fixed" v-show="leftFixedCount > 0" :style="[{width: layout.fixedWidth ? layout.fixedWidth + \'px\' : \'\'}, fixedHeight]"><div class="vue-table__fixed-header-wrapper" ref="fixedHeaderWrapper" v-show="showHeader"><table-header fixed="left" :style="{width: layout.fixedWidth ? layout.fixedWidth + \'px\' : \'\'}"></table-header></div><div class="vue-table__fixed-body-wrapper" ref="fixedBodyWrapper" :style="[{top: layout.headerHeight + \'px\'}, fixedBodyHeight]"><table-body ref="fixedTableBody" fixed="left" :style="{width: layout.fixedWidth ? layout.fixedWidth + \'px\' : \'\'}"></table-body></div><div class="vue-table__fixed-footer-wrapper" ref="fixedFooterWrapper" v-show="showFooter"><table-footer fixed="left" :style="{width: layout.fixedWidth ? layout.fixedWidth + \'px\' : \'\'}"></table-footer></div></div><div class="vue-table__fixed-right" v-show="rightFixedCount > 0" :style="[{width: layout.rightFixedWidth ? layout.rightFixedWidth + \'px\' : \'\'}, {right: layout.scrollY ? (border ? layout.gutterWidth : (layout.gutterWidth || 1)) + \'px\' : \'\'}, fixedHeight]"><div class="vue-table__fixed-header-wrapper" ref="rightFixedHeaderWrapper" v-show="showHeader"><table-header fixed="right" :style="{width: layout.rightFixedWidth ? layout.rightFixedWidth + \'px\' : \'\'}"></table-header></div><div class="vue-table__fixed-body-wrapper" ref="rightFixedBodyWrapper" :style="[{top: layout.headerHeight + \'px\'}, fixedBodyHeight]"><table-body ref="rightFixedTableBody" fixed="right" :style="{width: layout.rightFixedWidth ? layout.rightFixedWidth + \'px\' : \'\'}"></table-body></div><div class="vue-table__fixed-footer-wrapper" ref="rightFixedFooterWrapper" v-show="showFooter"><table-footer fixed="right" :style="{width: layout.rightFixedWidth ? layout.rightFixedWidth + \'px\' : \'\'}"></table-footer></div></div><div class="vue-table__fixed-right-patch" v-show="rightFixedCount > 0" :style="{width: layout.scrollY ? layout.gutterWidth + \'px\' : \'0\', height: layout.headerHeight + \'px\'}"></div><div class="vue-table__column-resize-proxy" ref="resizeProxy" v-show="resizeProxyVisible"></div><table-context-menu v-if="contextMenu" v-model="showContextMenu""></table-context-menu></div>',
		name: 'VueTable',
		props: {
			data: {
				type: Array,
				default: function() {
					return [];
				}
			},
			lazyload: Boolean,
			height: [String, Number],
			fit: {
				type: Boolean,
				default: true
			},
			stripe: Boolean,
			border: Boolean,
			context: {},
			showHeader: {
				type: Boolean,
				default: true
			},
			showFooter: Boolean,
			contextMenu: Boolean,
			rowClassName: [String, Function],
			rowStyle: [Object, Function],
			highlightCurrentRow: Boolean,
			highlightHoverRow: {
				type: Boolean,
				default: true
			},
			emptyText: String,
			defaultExpandAll: Boolean,
			defaultSort: {
				type: Array,
				default: function() {
					return [];
				}
			},
			tooltipEffect: {
				type: String,
				default: 'light'
			},
			expandClassName: [String, Function]
		},
		components: {
			TableHeader: TableHeader,
			TableBody: TableBody,
			TableFooter: TableFooter,
			TableContextMenu: TableContextMenu
		},
		methods: {
			exportCsv: function(params) {
				if (!VueUtil.isObject(params)) params = {};
				if (params.fileName) {
					if (params.fileName.indexOf('.csv') === -1) {
						params.fileName += '.csv';
					}
				} else {
					params.fileName = 'table.csv';
				}
				if (!VueUtil.isDef(params.original)) params.original = true;
				var columns = params.original ? this.store.states._columns : this.store.states.columns;
				columns = columns.filter(function(column) {
					return (column.property !== 'selectionColumn'
						&& column.property !== 'indexColumn'
						&& column.property !== 'expandColumn')
				});
				var datas = params.original ? this.store.states._data : this.store.states.data;
				var footer = [];
				if (this.showFooter) {
					footer = this.store.states.aggregates.filter(function(aggregate) {
						return (aggregate.property !== 'selectionColumn'
							&& aggregate.property !== 'indexColumn'
							&& aggregate.property !== 'expandColumn')
					}).map(function(aggregate) {
						return aggregate.label;
					});
				}
				var appendLine = function(content, row, options) {
					var separator = options.separator;
					var line = row.map(function(data) {
						return '"' + VueUtil.toString(data).replace(/"/g, '""') + '"';
					});
					content.push(line.join(separator));
				};
				var tableDataToCsv = function(columns, datas, footer, options) {
					options = VueUtil.merge({}, {separator: ','}, options);
					var columnOrder;
					var content = [];
					var column = [];
					if (columns) {
						columnOrder = columns.map(function(v) {
							if (VueUtil.isString(v)) return v;
							column.push(VueUtil.isDef(v.printLabel) ? v.printLabel : VueUtil.isDef(v.label) ? v.label : v.property);
							return v.property;
						});
						if (column.length > 0) appendLine(content, column, options);
					} else {
						columnOrder = [];
						VueUtil.loop(datas, function(v) {
							if (!VueUtil.isArray(v)) {
								columnOrder = columnOrder.concat(Object.keys(v));
							}
						});
						if (columnOrder.length > 0) {
							columnOrder = columnOrder.filter(function(value, index, self) {return self.indexOf(value) === index;});
							appendLine(content, columnOrder, options);
						}
					}
					VueUtil.loop(datas, function(row) {
						if (!VueUtil.isArray(row)) {
							row = columnOrder.map(function(k) {return VueUtil.isDef(row[k]) ? row[k] : '';});
						}
						appendLine(content, row, options);
					});
					if (VueUtil.isArray(footer)) {
						appendLine(content, footer, options);
					}
					return content.join('\r\n');
				};
				var data = tableDataToCsv(columns, datas, footer, params);
				var getDownloadUrl = function(text) {
					var BOM = '\uFEFF';
					if (Blob && URL && URL.createObjectURL) {
						var csvData = new Blob([BOM + text], {type: 'text/csv'});
						return URL.createObjectURL(csvData);
					} else {
						return 'data:attachment/csv;charset=utf-8,' + BOM + encodeURIComponent(text);
					}
				};
				var exportFile = function(fileName, text) {
					if (navigator.msSaveBlob) {
						var BOM = '\uFEFF';
						var csvData = new Blob([BOM + text], {type: 'text/csv'});
						navigator.msSaveBlob(csvData, fileName);
					} else {
						try {
							var link = document.createElement('a');
							link.download = fileName;
							link.href = getDownloadUrl(text);
							document.body.appendChild(link);
							link.click();
							document.body.removeChild(link);
						} catch (e) {
							Vue.notify.warning({message: Vue.t('vue.screenfull.canot')});
							throw e;
						}
					}
				};
				exportFile(params.fileName, data);
			},
			columnFilter: function(column, value) {
				this.store.commit('filterChange', {
					column: column,
					values: value
				});
			},
			multipleColumnSort: function(sortList) {
				this.store.states.sortingColumns = sortList || [];
				this.store.commit('changeSortCondition');
			},
			toggleContextMenu: function() {
				if (this.contextMenu) this.showContextMenu = !this.showContextMenu;
			},
			setCurrentRow: function(row) {
				this.store.commit('setCurrentRow', row);
			},
			getCurrentRow: function() {
				return this.store.states.currentRow;
			},
			toggleRowSelection: function(row, selected) {
				if (this.store.toggleRowSelection(row, selected)) {
					this.$emit('selection-change', this.store.states.selection);
				}
				this.store.updateAllSelected();
			},
			clearSelection: function() {
				this.store.clearSelection();
			},
			handleMouseLeave: function() {
				this.store.commit('setHoverRow', null);
				if (this.hoverState) this.hoverState = null;
			},
			updateScrollY: function() {
				this.layout.updateScrollY();
				var refs = this.$refs;
				refs.fixedBodyWrapper.scrollTop = this.bodyScroll.top;
				refs.rightFixedBodyWrapper.scrollTop = this.bodyScroll.top;
			},
			isCellHidden: function(index, fixed) {
				if (fixed === 'left') {
					return index >= this.leftFixedCount;
				}
				if (fixed === 'right') {
					return index < this.store.states.columns.length - this.rightFixedCount
				}
				return (index < this.leftFixedCount) || (index >= this.store.states.columns.length - this.rightFixedCount);
			},
			bindEvents: function() {
				var self = this;
				var refs = self.$refs;
				var bodyScroll = function() {
					var scrollLeft = this.scrollLeft;
					var scrollTop = this.scrollTop;
					if (self.bodyScroll.left !== scrollLeft) {
						self.bodyScroll.left = scrollLeft;
						refs.headerWrapper.scrollLeft = scrollLeft;
						refs.footerWrapper.scrollLeft = scrollLeft;
						if (scrollLeft === 0) {
							self.$emit('scroll-left');
						}
						if (scrollLeft === refs.bodyWrapper.scrollWidth - refs.bodyWrapper.clientWidth) {
							self.$emit('scroll-right');
						}
					}
					if (self.bodyScroll.top !== scrollTop) {
						refs.tableBody.updateZone(scrollTop);
						self.bodyScroll.top = scrollTop;
						refs.fixedBodyWrapper.scrollTop = scrollTop;
						refs.rightFixedBodyWrapper.scrollTop = scrollTop;
						if (scrollTop === 0) {
							self.$emit('scroll-top');
						}
						if (scrollTop === refs.bodyWrapper.scrollHeight - refs.bodyWrapper.clientHeight) {
							self.$emit('scroll-bottom');
						}
					}
				};
				var scrollYMouseWheel = function(event) {
					if (self.layout.scrollY) {
						event.preventDefault();
						var wheelDelta = event.wheelDelta || -event.detail;
						var scrollTop = self.bodyScroll.top;
						var wheel = 40;
						if (VueUtil.isElement(self.$refs.tableBody.$refs.tbody)) wheel = self.$refs.tableBody.$refs.tbody.firstElementChild.offsetHeight;
						wheel = wheel * 3;
						if (wheelDelta < 0) {
							scrollTop += wheel;
						} else {
							scrollTop -= wheel;
						}
						var scrollBottom = refs.bodyWrapper.scrollHeight - refs.bodyWrapper.clientHeight;
						scrollTop < 0 ? scrollTop = 0 : null;
						scrollTop > scrollBottom ? scrollTop = scrollBottom : null;
						refs.bodyWrapper.scrollTop = scrollTop;
						refs.fixedBodyWrapper.scrollTop = scrollTop;
						refs.rightFixedBodyWrapper.scrollTop = scrollTop;
					}
				};
				var scrollXMouseWheel = function(event) {
					if (self.layout.scrollX) {
						event.preventDefault();
						var wheelDelta = event.wheelDelta || -event.detail;
						var scrollLeft = self.bodyScroll.left;
						if (wheelDelta < 0) {
							scrollLeft += 80;
						} else {
							scrollLeft -= 80;
						}
						var scrollRight = refs.bodyWrapper.scrollWidth - refs.bodyWrapper.clientWidth;
						scrollLeft < 0 ? scrollLeft = 0 : null;
						scrollLeft > scrollRight ? scrollLeft = scrollRight : null;
						refs.bodyWrapper.scrollLeft = scrollLeft;
						refs.headerWrapper.scrollLeft = scrollLeft;
						refs.footerWrapper.scrollLeft = scrollLeft;
					}
				};
				var mouseWheel = VueUtil.isFirefox ? 'DOMMouseScroll' : 'mousewheel';
				VueUtil.on(refs.bodyWrapper, 'scroll', bodyScroll);
				VueUtil.on(refs.bodyWrapper, mouseWheel, scrollYMouseWheel);
				VueUtil.on(refs.fixedBodyWrapper, mouseWheel, scrollYMouseWheel);
				VueUtil.on(refs.rightFixedBodyWrapper, mouseWheel, scrollYMouseWheel);
				VueUtil.on(refs.headerWrapper, mouseWheel, scrollXMouseWheel);
				VueUtil.on(refs.fixedHeaderWrapper, mouseWheel, scrollXMouseWheel);
				VueUtil.on(refs.rightFixedHeaderWrapper, mouseWheel, scrollXMouseWheel);
				VueUtil.on(refs.footerWrapper, mouseWheel, scrollXMouseWheel);
				VueUtil.on(refs.fixedFooterWrapper, mouseWheel, scrollXMouseWheel);
				VueUtil.on(refs.rightFixedFooterWrapper, mouseWheel, scrollXMouseWheel);
				if (self.fit) {
					VueUtil.addResizeListener(self.$el, self.doLayout);
				}
			},
			resizeZone: function() {
				var refs = this.$refs;
				refs.tableBody.updateZone(this.bodyScroll.top);
				if (this.showFooter) {
					this.store.getAggregate(this.store.states.columns, this.store.states.data);
					refs.tableFooter.aggregates = this.store.states.aggregates
				}
			},
			doLayout: function() {
				var self = this;
				self.store.updateColumns();
				self.layout.update();
				self.$nextTick(function() {
					self.layout.updateHeight();
					self.updateScrollY();
					self.resizeZone();
				});
			}
		},
		created: function() {
			this.tableId = 'vue-table_';
		},
		computed: {
			emptyLabel: function() {
				return this.$t('vue.table.emptyText')
			},
			leftFixedCount: function() {
				return this.store.states.fixedColumns.length;
			},
			rightFixedCount: function() {
				return this.store.states.rightFixedColumns.length;
			},
			bodyHeight: function() {
				var style = {};
				style = {
					height: this.layout.bodyHeight ? this.layout.bodyHeight + 'px' : ''
				};
				return style;
			},
			bodyWidth: function() {
				var layout = this.layout;
				return layout.bodyWidth ? layout.bodyWidth - (layout.scrollY ? layout.gutterWidth : 0) + 'px' : '';
			},
			fixedBodyHeight: function() {
				var style = {};
				var layout = this.layout;
				if (this.height) {
					style = {
						height: layout.fixedBodyHeight ? layout.fixedBodyHeight + 'px' : ''
					};
				}
				return style;
			},
			fixedHeight: function() {
				var style = {};
				var layout = this.layout;
				style = {
					height: layout.viewportHeight ? layout.viewportHeight + 'px' : ''
				};
				return style;
			}
		},
		watch: {
			height: function(val) {
				this.layout.setHeight(val);
			},
			data: {
				immediate: true,
				handler: function(val) {
					var store = this.store;
					store.commit('setData', val);
					if (store.states.sortingColumns.length > 0) {
						this.$nextTick(function() {
							VueUtil.loop(store.states.columns, function(column) {
								if (column.filteredValue && column.filteredValue.length) {
									store.commit('filterChange', {
										column: cloumn,
										values: column.filteredValue,
										silent: true
									});
								}
							});
							store.commit('changeSortCondition');
						});
					}
				}
			},
			showHeader: function(val) {
				this.doLayout();
			},
			showFooter: function(val) {
				this.doLayout();
			},
			lazyload: function(val) {
				if (this.height) {
					var delta = this.$refs.tableBody.$options.delta;
					if (val) {
						delta.keeps = this.height * 1;
					} else {
						delta.keeps = 0;
					}
					this.doLayout();
				}
			}
		},
		beforeDestroy: function() {
			if (this.fit) {
				VueUtil.removeResizeListener(this.$el, this.doLayout);
			}
		},
		mounted: function() {
			var self = this;
			if (self.height) {
				self.layout.setHeight(self.height);
			}
			self.$nextTick(function() {
				self.bindEvents();
				self.doLayout();
			});
		},
		data: function() {
			var store = new TableStore(this, {defaultExpandAll: self.defaultExpandAll});
			var layout = new TableLayout({
				store: store,
				table: this,
				fit: this.fit,
				showHeader: self.showHeader
			});
			return {
				store: store,
				layout: layout,
				renderExpanded: null,
				resizeProxyVisible: false,
				showContextMenu: false,
				bodyScroll: {left: 0, top: 0}
			};
		}
	};
	Vue.component(VueTable.name, VueTable);
});
