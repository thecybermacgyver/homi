import {sql} from 'drizzle-orm';
import {betterAuth} from 'better-auth';
import {drizzleAdapter} from '@better-auth/drizzle-adapter';
import {HOMI_BETTER_AUTH_SCHEMA,createHomiDatabase,users,householdMemberships,householdPeople} from '@homi/db';
if(process.env.HOMI_AUTH_BASE_URL!=='http://localhost:3300')throw new Error('Test stack only');
const database=createHomiDatabase(process.env.HOMI_DATABASE_URL);
try {
const auth=betterAuth({secret:process.env.HOMI_AUTH_SECRET,baseURL:'http://localhost:3300',
  database:drizzleAdapter(database.db,{provider:'pg',schemaName:'auth',schema:HOMI_BETTER_AUTH_SCHEMA}),
  emailAndPassword:{enabled:true,disableSignUp:false,autoSignIn:false},advanced:{database:{generateId:'uuid'}},telemetry:{enabled:false}});
const signup=await auth.api.signUpEmail({body:{name:'Shopping Second Member',email:'shopping-second@example.invalid',password:process.env.HOMI_BOOTSTRAP_PASSWORD}});
const result=await database.db.transaction(async tx=>{
 const home=await tx.execute(sql`SELECT id FROM core.households WHERE name=${process.env.HOMI_BOOTSTRAP_HOUSEHOLD}`);
 if(home.rows.length!==1)throw new Error('Expected one test household');
 const householdId=home.rows[0].id;
 const [user]=await tx.insert(users).values({authSubject:signup.user.id,displayName:'Shopping Second Member',preferredLocale:'en-CA',timeZone:'America/Toronto'}).returning();
 const [membership]=await tx.insert(householdMemberships).values({householdId,userId:user.id}).returning();
 await tx.insert(householdPeople).values({householdId,linkedMembershipId:membership.id,displayName:'Shopping Second Member'});
 return {userId:user.id,householdId};
});console.log(JSON.stringify(result));
} finally {await database.close();}
