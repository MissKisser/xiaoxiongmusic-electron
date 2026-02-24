import type { FastifyPluginAsync } from 'fastify';
import { query } from '../db.js';
import { serverLog } from '../logger.js';

interface AuthVerifyBody {
    code: string;
    deviceId: string;
    platform?: string;
    deviceName?: string;
}

interface AuthCheckQuery {
    deviceId: string;
}

export const initAuthAPI: FastifyPluginAsync = async (fastify) => {
    // 验证授权码
    fastify.post<{ Body: AuthVerifyBody }>('/auth/verify', async (request, reply) => {
        try {
            const { code, deviceId, platform = 'android', deviceName } = request.body;
            const clientIp = request.headers['x-real-ip'] as string || request.ip;

            if (!code || !deviceId) {
                return reply.code(400).send({ success: false, message: '缺少必要参数' });
            }

            // 查询授权码
            const codes = await query<any[]>(
                'SELECT * FROM auth_codes WHERE code = ?',
                [code]
            );

            if (codes.length === 0) {
                return reply.code(401).send({ success: false, message: '授权码无效' });
            }

            const authCode = codes[0];

            // 检查状态
            if (authCode.status === 'disabled') {
                return reply.code(403).send({ success: false, message: '该授权码已被禁用' });
            }

            // 更新授权码状态
            await query(
                `UPDATE auth_codes SET 
          status = 'active',
          last_login_at = NOW(),
          last_login_ip = ?
        WHERE id = ?`,
                [clientIp, authCode.id]
            );

            // 按平台独立绑定：解绑同一授权码 + 同一平台的其他设备
            await query(
                `UPDATE devices SET auth_code_id = NULL 
         WHERE auth_code_id = ? AND platform = ? AND device_id != ?`,
                [authCode.id, platform, deviceId]
            );

            // 更新或插入当前设备记录
            const existingDevices = await query<any[]>(
                'SELECT * FROM devices WHERE device_id = ?',
                [deviceId]
            );

            if (existingDevices.length > 0) {
                await query(
                    `UPDATE devices SET 
            auth_code_id = ?,
            ip = ?,
            name = ?,
            platform = ?,
            last_active_at = NOW()
          WHERE device_id = ?`,
                    [authCode.id, clientIp, deviceName || null, platform, deviceId]
                );
            } else {
                await query(
                    `INSERT INTO devices (device_id, auth_code_id, platform, ip, name) 
           VALUES (?, ?, ?, ?, ?)`,
                    [deviceId, authCode.id, platform, clientIp, deviceName || null]
                );
            }

            serverLog.info(`✅ Device ${deviceId} (${platform}) authorized with code ${code.substring(0, 20)}...`);

            return reply.send({
                success: true,
                message: '授权成功',
                data: {
                    code: authCode.code,
                    remarks: authCode.remarks,
                }
            });
        } catch (error) {
            serverLog.error('Auth verify error:', error);
            return reply.code(500).send({ success: false, message: '服务器错误' });
        }
    });

    // 检查授权状态
    fastify.get<{ Querystring: AuthCheckQuery }>('/auth/check', async (request, reply) => {
        try {
            const { deviceId } = request.query;

            if (!deviceId) {
                return reply.code(400).send({ success: false, message: '缺少设备ID' });
            }

            // 查询设备及其绑定的授权码
            const devices = await query<any[]>(
                'SELECT d.*, ac.code, ac.status as code_status FROM devices d LEFT JOIN auth_codes ac ON d.auth_code_id = ac.id WHERE d.device_id = ?',
                [deviceId]
            );

            if (devices.length === 0) {
                return reply.code(401).send({
                    success: false,
                    authorized: false,
                    message: '设备未授权'
                });
            }

            const device = devices[0];

            // 检查设备是否被封禁
            if (device.status === 'banned') {
                return reply.code(403).send({
                    success: false,
                    authorized: false,
                    message: '该设备已被封禁'
                });
            }

            // 检查授权码状态
            if (!device.auth_code_id || device.code_status !== 'active') {
                return reply.code(401).send({
                    success: false,
                    authorized: false,
                    message: '授权已失效，请重新输入授权码'
                });
            }

            // 按平台检查是否被顶号：
            // 查找同一授权码 + 同一平台下，是否有其他设备绑定
            const samePlatformDevices = await query<any[]>(
                'SELECT device_id FROM devices WHERE auth_code_id = ? AND platform = ? AND device_id != ?',
                [device.auth_code_id, device.platform, deviceId]
            );

            if (samePlatformDevices.length > 0) {
                return reply.code(401).send({
                    success: false,
                    authorized: false,
                    message: '该授权码已在同平台的其他设备登录'
                });
            }

            // 更新最后活跃时间
            await query(
                'UPDATE devices SET last_active_at = NOW() WHERE device_id = ?',
                [deviceId]
            );

            return reply.send({
                success: true,
                authorized: true,
                message: '授权有效'
            });
        } catch (error) {
            serverLog.error('Auth check error:', error);
            return reply.code(500).send({ success: false, message: '服务器错误' });
        }
    });
};
