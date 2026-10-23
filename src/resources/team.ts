import type { RequestOptions } from '../http.js';
import type { TeamInviteParams, TeamMember, TeamRole } from '../types.js';
import { API, Resource, id } from './base.js';

export class Team extends Resource {
  async list(options?: RequestOptions): Promise<TeamMember[]> {
    const data = await this.data<{ team_members?: TeamMember[] }>({ ...options, method: 'GET', path: `${API}/team` });
    return data?.team_members ?? [];
  }

  invite(params: TeamInviteParams, options?: RequestOptions): Promise<TeamMember> {
    return this.data({ ...options, method: 'POST', path: `${API}/team/invite`, body: params });
  }

  retrieve(memberId: number, options?: RequestOptions): Promise<TeamMember> {
    return this.data({ ...options, method: 'GET', path: `${API}/team/${id(memberId)}` });
  }

  async updateRole(memberId: number, role: TeamRole, options?: RequestOptions): Promise<void> {
    await this.http.request({ ...options, method: 'PUT', path: `${API}/team/${id(memberId)}/role`, body: { role } });
  }

  async remove(memberId: number, options?: RequestOptions): Promise<void> {
    await this.http.request({ ...options, method: 'DELETE', path: `${API}/team/${id(memberId)}` });
  }
}
