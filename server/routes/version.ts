import type { FastifyPluginAsync } from 'fastify';
import { query } from '../db.js';
import { serverLog } from '../logger.js';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'xiaoxiong_music_secret_key_2026';

// JWT 验证中间件
const verifyToken = async (request: any, reply: any) => {
    try {
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return reply.code(401).send({ success: false, message: '未登录' });
        }
        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, JWT_SECRET) as { username: string };
        request.admin = decoded;
    } catch (error) {
        return reply.code(401).send({ success: false, message: 'Token 无效或已过期' });
    }
};

export const initVersionAPI: FastifyPluginAsync = async (fastify) => {
    // 检查版本 (公开接口)
    fastify.get<{ Querystring: { platform?: string; version?: string } }>('/version/check', async (request, reply) => {
        try {
            const { platform = 'android', version: currentVersion } = request.query;

            // 获取最新版本
            const versions = await query<any[]>(
                'SELECT * FROM app_versions WHERE platform = ? ORDER BY build_number DESC LIMIT 1',
                [platform]
            );

            if (versions.length === 0) {
                return reply.send({
                    success: true,
                    hasUpdate: false,
                    message: '已是最新版本'
                });
            }

            const latestVersion = versions[0];

            // 版本比较 (支持预发布版本，如 3.0.0-beta.9)
            const compareVersions = (v1: string, v2: string): number => {
                // 去除预发布后缀 (如 -beta.9, -alpha.1, -rc.2)
                const stripPreRelease = (v: string) => v.replace(/-.*$/, '');
                const clean1 = stripPreRelease(v1);
                const clean2 = stripPreRelease(v2);
                const parts1 = clean1.split('.').map(Number);
                const parts2 = clean2.split('.').map(Number);
                for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
                    const p1 = parts1[i] || 0;
                    const p2 = parts2[i] || 0;
                    if (p1 > p2) return 1;
                    if (p1 < p2) return -1;
                }
                // 版本号相同时，有预发布后缀的版本 < 无预发布后缀的版本
                const hasPre1 = v1.includes('-');
                const hasPre2 = v2.includes('-');
                if (hasPre1 && !hasPre2) return -1;
                if (!hasPre1 && hasPre2) return 1;
                return 0;
            };

            const hasUpdate = currentVersion
                ? compareVersions(latestVersion.version, currentVersion) > 0
                : true;

            return reply.send({
                success: true,
                hasUpdate,
                data: hasUpdate ? {
                    version: latestVersion.version,
                    buildNumber: latestVersion.build_number,
                    downloadUrl: latestVersion.apk_url,
                    apkUrl: latestVersion.apk_url, // 向后兼容
                    description: latestVersion.description,
                    isForce: !!latestVersion.is_force
                } : null
            });
        } catch (error) {
            serverLog.error('Version check error:', error);
            return reply.code(500).send({ success: false, message: '服务器错误' });
        }
    });

    // ===== 管理接口 (需要登录) =====

    // 获取版本列表
    fastify.get('/admin/versions', { preHandler: verifyToken }, async (request, reply) => {
        try {
            const versions = await query<any[]>(
                'SELECT * FROM app_versions ORDER BY build_number DESC'
            );
            return reply.send({ success: true, data: versions });
        } catch (error) {
            serverLog.error('Get versions error:', error);
            return reply.code(500).send({ success: false, message: '服务器错误' });
        }
    });

    // 发布新版本
    fastify.post<{
        Body: {
            version: string;
            buildNumber?: number;
            platform?: string;
            apkUrl: string;
            description?: string;
            isForce?: boolean
        }
    }>('/admin/versions', { preHandler: verifyToken }, async (request, reply) => {
        try {
            const { version, buildNumber, platform = 'android', apkUrl, description, isForce = false } = request.body;
            const admin = (request as any).admin;

            if (!version || !apkUrl) {
                return reply.code(400).send({ success: false, message: '版本号和下载链接不能为空' });
            }

            // 自动计算 build number (如果未提供)
            let finalBuildNumber = buildNumber;
            if (!finalBuildNumber) {
                const versions = await query<any[]>(
                    'SELECT MAX(build_number) as max_build FROM app_versions WHERE platform = ?',
                    [platform]
                );
                finalBuildNumber = (versions[0].max_build || 0) + 1;
            }

            await query(
                `INSERT INTO app_versions (version, build_number, platform, apk_url, description, is_force) 
         VALUES (?, ?, ?, ?, ?, ?)`,
                [version, finalBuildNumber, platform, apkUrl, description || null, isForce]
            );

            // 记录日志
            await query(
                'INSERT INTO audit_logs (admin_username, action, details) VALUES (?, ?, ?)',
                [admin.username, 'PUBLISH_VERSION', JSON.stringify({ version, platform, isForce })]
            );

            return reply.send({
                success: true,
                message: `版本 ${version} 发布成功`
            });
        } catch (error) {
            serverLog.error('Publish version error:', error);
            return reply.code(500).send({ success: false, message: '服务器错误' });
        }
    });

    // 删除版本
    fastify.delete<{ Params: { id: string } }>('/admin/versions/:id', { preHandler: verifyToken }, async (request, reply) => {
        try {
            const { id } = request.params;
            const admin = (request as any).admin;

            await query('DELETE FROM app_versions WHERE id = ?', [id]);

            // 记录日志
            await query(
                'INSERT INTO audit_logs (admin_username, action, details) VALUES (?, ?, ?)',
                [admin.username, 'DELETE_VERSION', JSON.stringify({ id })]
            );

            return reply.send({ success: true, message: '删除成功' });
        } catch (error) {
            serverLog.error('Delete version error:', error);
            return reply.code(500).send({ success: false, message: '服务器错误' });
        }
    });
};
