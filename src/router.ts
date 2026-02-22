import { createRouter, createWebHistory } from 'vue-router'
import EditorView from '@/gui/views/EditorView.vue'
import PlayerView from '@/gui/views/PlayerView.vue'

export const router = createRouter({
    history: createWebHistory(),
    routes: [
        {
            path: '/play/:name*',
            component: PlayerView,
            props: (route) => ({ levelName: Array.isArray(route.params.name) ? route.params.name.join('/') : (route.params.name || '') })
        },
        {
            path: '/editor/:name*',
            component: EditorView,
            props: (route) => ({ initialLevelName: Array.isArray(route.params.name) ? route.params.name.join('/') : (route.params.name || '') })
        },
        {
            path: '/',
            component: EditorView,
            props: { initialLevelName: '' }
        },
        // Catch-all to root or editor
        {
            path: '/:pathMatch(.*)*',
            redirect: '/'
        }
    ]
})
