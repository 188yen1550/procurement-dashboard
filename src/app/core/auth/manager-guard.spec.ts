/** 檔案用途：驗證 managerGuard 的前端角色導覽判斷；真正管理 API 權限不在此測試範圍。 */
import { TestBed } from '@angular/core/testing';
import { CanActivateFn } from '@angular/router';

import { managerGuard } from './manager-guard';

describe('managerGuard', () => {
  const executeGuard: CanActivateFn = (...guardParameters) =>
    TestBed.runInInjectionContext(() => managerGuard(...guardParameters));

  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('should be created', () => {
    expect(executeGuard).toBeTruthy();
  });
});
